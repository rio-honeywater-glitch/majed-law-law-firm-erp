import { useState, useEffect, useRef } from "react";
import {
  useListExecutions,
  getListExecutionsQueryKey,
  useCreateExecution,
  useUpdateExecution,
  useListCases,
  getListCasesQueryKey,
  useRecordTransferOrder,
  useGetExecutionTransferOrderSummary,
  getGetExecutionTransferOrderSummaryQueryKey,
  useListExecutionTransferOrderLogs,
  getListExecutionTransferOrderLogsQueryKey,
} from "@workspace/api-client-react";
import { DateRangeFilter, filterByDateRange, type DateRangeValue } from "@/components/ui/date-range-filter";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Gavel, Plus, ChevronsUpDown, Check, Pencil, Activity, CheckCircle2, Handshake, X, ArrowRightLeft, Clock, TriangleAlert, History, Download, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useSortable, SortableHead, IndexHead } from "@/components/ui/sortable-table";

// ─── Schemas ────────────────────────────────────────────────────────────────

const executionSchema = z.object({
  caseId: z.string().min(1, "يجب اختيار القضية"),
  executionNumber: z.string().optional(),
  type: z.string().optional(),
  totalAmount: z.string().min(1, "المبلغ الإجمالي مطلوب").refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, "قيمة غير صالحة"),
  paidAmount: z.string().refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "قيمة غير صالحة"),
});
type ExecutionFormValues = z.infer<typeof executionSchema>;

const editSchema = z.object({
  withdrawalAmount: z
    .string()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "قيمة غير صالحة"),
  status: z.enum(["ACTIVE", "FULL_PAYMENT", "SETTLEMENT"]),
});
type EditFormValues = z.infer<typeof editSchema>;

// ─── Transfer-order helpers ──────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function needsTransferOrder(e: { status: string; lastTransferOrderAt?: string | null }): boolean {
  if (e.status === "FULL_PAYMENT" || e.status === "SETTLEMENT") return false;
  if (!e.lastTransferOrderAt) return true;
  return Date.now() - new Date(e.lastTransferOrderAt).getTime() >= SEVEN_DAYS_MS;
}

function getTransferCountdown(lastTransferOrderAt: string, now: number) {
  const remaining = SEVEN_DAYS_MS - (now - new Date(lastTransferOrderAt).getTime());
  if (remaining <= 0) return null;
  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return { days, hours };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "error" in err && typeof (err as { error: unknown }).error === "string") {
    return (err as { error: string }).error;
  }
  return fallback;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const d = new Date(iso);
  return (
    <span className="tabular-nums text-xs">
      {d.toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}
    </span>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "FULL_PAYMENT": return <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white">سداد كامل</Badge>;
    case "PARTIAL_PAYMENT": return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">سداد جزئي</Badge>;
    case "SETTLEMENT": return <Badge variant="secondary">تسوية</Badge>;
    default: return <Badge variant="default">نشط</Badge>;
  }
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "نشط" },
  { value: "FULL_PAYMENT", label: "سداد كامل" },
  { value: "SETTLEMENT", label: "تسوية" },
] as const;

// ─── Edit Dialog ─────────────────────────────────────────────────────────────

interface EditDialogProps {
  execution: {
    id: number;
    paidAmount: number;
    totalAmount: number;
    remainingAmount: number;
    status: string;
    lastWithdrawalAt?: string | null;
    lastWithdrawalBy?: string | null;
    executionNumber?: string | null;
    transferOrderCount?: number | null;
    lastTransferOrderAt?: string | null;
  };
  onSuccess: () => void;
}

function EditDialog({ execution, onSuccess }: EditDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const updateExecution = useUpdateExecution();

  const normalStatus = (["ACTIVE", "FULL_PAYMENT", "SETTLEMENT"].includes(execution.status)
    ? execution.status : "ACTIVE") as "ACTIVE" | "FULL_PAYMENT" | "SETTLEMENT";

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { withdrawalAmount: "", status: normalStatus },
  });

  const withdrawalAmountVal = form.watch("withdrawalAmount");
  const statusVal = form.watch("status");
  const addedAmount = Number(withdrawalAmountVal) || 0;
  const newPaid = execution.paidAmount + addedAmount;
  const newRemaining = execution.totalAmount - newPaid;

  // ── Auto-sync: status → amount ──────────────────────────────────────────
  // When user picks "سداد كامل", fill the exact remaining amount automatically
  useEffect(() => {
    if (!open) return;
    if (statusVal === "FULL_PAYMENT") {
      const needed = String(execution.remainingAmount);
      if (form.getValues("withdrawalAmount") !== needed) {
        form.setValue("withdrawalAmount", needed, { shouldValidate: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusVal]);

  // ── Auto-sync: amount → status ──────────────────────────────────────────
  // When typed amount covers the remaining → upgrade to "سداد كامل" automatically
  // When it no longer covers it → revert to "نشط"
  useEffect(() => {
    if (!open) return;
    const added = Number(form.getValues("withdrawalAmount")) || 0;
    const paid = execution.paidAmount + added;
    const currentStatus = form.getValues("status");
    if (paid >= execution.totalAmount && currentStatus !== "FULL_PAYMENT") {
      form.setValue("status", "FULL_PAYMENT", { shouldValidate: true });
    } else if (paid < execution.totalAmount && currentStatus === "FULL_PAYMENT") {
      form.setValue("status", "ACTIVE", { shouldValidate: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawalAmountVal]);

  const onSubmit = async (data: EditFormValues) => {
    const added = Number(data.withdrawalAmount) || 0;
    const newPaidAmount = Math.min(execution.paidAmount + added, execution.totalAmount);
    try {
      await updateExecution.mutateAsync({
        id: execution.id,
        data: { paidAmount: newPaidAmount, status: data.status },
      });
      toast({ title: "✅ تم تحديث طلب التنفيذ بنجاح" });
      onSuccess();
      setOpen(false);
      form.reset({ withdrawalAmount: "", status: data.status });
    } catch (err) {
      toast({ variant: "destructive", title: "فشل التحديث", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) form.reset({ withdrawalAmount: "", status: normalStatus }); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group/edit flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <span className="font-mono font-semibold text-destructive text-sm group-hover/edit:text-primary transition-colors">
            {execution.remainingAmount.toLocaleString()} ﷼
          </span>
          <Pencil className="w-3 h-3 text-muted-foreground/50 group-hover/edit:text-primary transition-colors shrink-0" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            تحديث التنفيذ
            {execution.executionNumber ? ` — ${execution.executionNumber}` : ""}
          </DialogTitle>
        </DialogHeader>

        {/* Current state summary */}
        <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1.5 border">
          <div className="flex justify-between">
            <span className="text-muted-foreground">الإجمالي</span>
            <span className="font-mono font-medium">{execution.totalAmount.toLocaleString()} ﷼</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">المسدَّد حتى الآن</span>
            <span className="font-mono font-medium text-emerald-600">{execution.paidAmount.toLocaleString()} ﷼</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">المتبقي</span>
            <span className="font-mono font-medium text-destructive">{execution.remainingAmount.toLocaleString()} ﷼</span>
          </div>
          {execution.lastWithdrawalBy && (
            <div className="flex justify-between pt-1 border-t">
              <span className="text-muted-foreground">آخر سحب بواسطة</span>
              <span className="text-xs text-right">{execution.lastWithdrawalBy}</span>
            </div>
          )}
          {((execution.transferOrderCount ?? 0) > 0 || execution.lastTransferOrderAt) && (
            <div className="flex justify-between pt-1 border-t">
              <span className="text-muted-foreground">أوامر التحويل</span>
              <div className="flex items-center gap-2 text-xs text-right">
                {(execution.transferOrderCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                    <ArrowRightLeft className="w-2.5 h-2.5" />
                    {execution.transferOrderCount} أمر
                  </span>
                )}
                {execution.lastTransferOrderAt && (
                  <span className="tabular-nums text-muted-foreground">
                    {new Date(execution.lastTransferOrderAt).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

          {/* ── Status picker (first so user can trigger auto-fill) ── */}
          <div className="space-y-2">
            <Label>الحالة</Label>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger dir="rtl">
                    <SelectValue placeholder="اختر الحالة" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {statusVal === "FULL_PAYMENT" && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                تم تعيين مبلغ السداد الكامل تلقائياً ({execution.remainingAmount.toLocaleString()} ﷼)
              </p>
            )}
          </div>

          {/* ── Withdrawal amount ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="withdrawal-amount">مبلغ السحب الجديد (﷼)</Label>
              {execution.remainingAmount > 0 && statusVal !== "SETTLEMENT" && (
                <button
                  type="button"
                  onClick={() => form.setValue("withdrawalAmount", String(execution.remainingAmount), { shouldValidate: true })}
                  className="text-[11px] text-primary underline-offset-2 hover:underline"
                >
                  سداد كامل ({execution.remainingAmount.toLocaleString()} ﷼)
                </button>
              )}
            </div>
            <Input
              id="withdrawal-amount"
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              placeholder={statusVal === "SETTLEMENT" ? "اختياري عند التسوية" : "0.00"}
              disabled={statusVal === "SETTLEMENT" && addedAmount === 0}
              {...form.register("withdrawalAmount")}
            />
            {form.formState.errors.withdrawalAmount && (
              <p className="text-xs text-destructive">{form.formState.errors.withdrawalAmount.message}</p>
            )}

            {/* Live preview */}
            {addedAmount > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md p-2.5 text-xs space-y-1">
                {/* Progress bar */}
                <div className="w-full bg-emerald-200/50 dark:bg-emerald-900/40 rounded-full h-1.5 mb-2">
                  <div
                    className="bg-emerald-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (newPaid / execution.totalAmount) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">إجمالي المسدَّد بعد السحب</span>
                  <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {Math.min(newPaid, execution.totalAmount).toLocaleString()} ﷼
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">المتبقي بعد السحب</span>
                  <span className={`font-mono font-semibold ${newRemaining <= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
                    {Math.max(0, newRemaining).toLocaleString()} ﷼
                  </span>
                </div>
                {newRemaining <= 0 && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 pt-0.5 border-t border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    سيتم تحديث الحالة إلى "سداد كامل" تلقائياً
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={updateExecution.isPending} className="w-full gap-2">
              {updateExecution.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ التحديث
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Transfer-order log dialog ───────────────────────────────────────────────

function TransferOrderLogDialog({ executionId, executionNumber }: { executionId: number; executionNumber?: string | null }) {
  const [open, setOpen] = useState(false);
  const { data: logs, isLoading } = useListExecutionTransferOrderLogs(executionId, {
    query: { queryKey: getListExecutionTransferOrderLogsQueryKey(executionId), enabled: open },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors mt-1"
          title="عرض سجل أوامر التحويل"
        >
          <History className="w-3 h-3" />
          عرض السجل
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            سجل أوامر التحويل
            {executionNumber ? ` — ${executionNumber}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : !logs || logs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">لا توجد أوامر تحويل مسجّلة</p>
          ) : (
            logs.map((log, idx) => {
              const d = new Date(log.createdAt);
              return (
                <div
                  key={log.id}
                  className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/30 transition-colors"
                >
                  <span className="text-muted-foreground text-xs font-mono tabular-nums w-5 shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{log.createdBy}</p>
                  </div>
                  <div className="text-left shrink-0">
                    <p className="text-xs tabular-nums font-medium">
                      {d.toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Executions() {
  const DATE_FILTER_KEY = "executions-date-filter";
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateRangeValue>(() => {
    try {
      const saved = localStorage.getItem("executions-date-filter");
      if (saved) {
        const parsed = JSON.parse(saved) as DateRangeValue;
        if (parsed && typeof parsed.preset === "string") return parsed;
      }
    } catch { /* ignore */ }
    return { preset: "all" };
  });
  const STATUS_FILTER_KEY = "executions-status-filter";
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "FULL_PAYMENT" | "SETTLEMENT" | "PENDING_TRANSFER" | null>(() => {
    const saved = localStorage.getItem("executions-status-filter");
    return (saved === "ACTIVE" || saved === "FULL_PAYMENT" || saved === "SETTLEMENT" || saved === "PENDING_TRANSFER") ? saved : null;
  });
  const [caseOpen, setCaseOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState(() => localStorage.getItem("export-logs-from") ?? "");
  const [exportTo, setExportTo] = useState(() => localStorage.getItem("export-logs-to") ?? "");
  const [exportCount, setExportCount] = useState<number | null>(null);
  const [exportCountLoading, setExportCountLoading] = useState(false);

  // ── PDF summary export dialog state ─────────────────────────────────────────
  const [pdfExportDialogOpen, setPdfExportDialogOpen] = useState(false);
  const [pdfExportFrom, setPdfExportFrom] = useState("");
  const [pdfExportTo, setPdfExportTo] = useState("");
  const [pdfExportStatus, setPdfExportStatus] = useState<string>("ALL");
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // ── Payments export dialog state ─────────────────────────────────────────────
  const [paymentsExportDialogOpen, setPaymentsExportDialogOpen] = useState(false);
  const [paymentsExportFrom, setPaymentsExportFrom] = useState("");
  const [paymentsExportTo, setPaymentsExportTo] = useState("");
  const [paymentsExportStatus, setPaymentsExportStatus] = useState<string>("ALL");
  const [paymentsExportCount, setPaymentsExportCount] = useState<number | null>(null);
  const [paymentsExportCountLoading, setPaymentsExportCountLoading] = useState(false);
  const [isPaymentsExporting, setIsPaymentsExporting] = useState(false);

  // ── Executions export dialog state ──────────────────────────────────────────
  const [execExportDialogOpen, setExecExportDialogOpen] = useState(false);
  const [execExportFrom, setExecExportFrom] = useState("");
  const [execExportTo, setExecExportTo] = useState("");
  const [execExportStatus, setExecExportStatus] = useState<string>("ALL");
  const [execExportCount, setExecExportCount] = useState<number | null>(null);
  const [execExportCountLoading, setExecExportCountLoading] = useState(false);
  const [isExecExporting, setIsExecExporting] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location] = useLocation();
  const highlightedId = (() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const v = new URLSearchParams(search).get("execution");
    return v ? parseInt(v, 10) : null;
  })();
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  const EXPORT_FROM_KEY = "export-logs-from";
  const EXPORT_TO_KEY = "export-logs-to";

  const restoreExportDates = () => {
    setExportFrom(localStorage.getItem(EXPORT_FROM_KEY) ?? "");
    setExportTo(localStorage.getItem(EXPORT_TO_KEY) ?? "");
  };

  // Fetch record count whenever the export dialog is open and dates change
  useEffect(() => {
    if (!exportDialogOpen) { setExportCount(null); return; }
    let cancelled = false;
    setExportCountLoading(true);
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const params = new URLSearchParams();
        if (exportFrom) params.set("from", exportFrom);
        if (exportTo) params.set("to", exportTo);
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/executions/transfer-order-logs/count${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("fetch count failed");
        const data = await res.json();
        if (!cancelled) setExportCount(data.count ?? 0);
      } catch {
        if (!cancelled) setExportCount(null);
      } finally {
        if (!cancelled) setExportCountLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [exportDialogOpen, exportFrom, exportTo]);

  // Fetch payments count whenever the payments export dialog is open / filters change
  useEffect(() => {
    if (!paymentsExportDialogOpen) { setPaymentsExportCount(null); return; }
    let cancelled = false;
    setPaymentsExportCountLoading(true);
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const params = new URLSearchParams();
        if (paymentsExportFrom) params.set("from", paymentsExportFrom);
        if (paymentsExportTo) params.set("to", paymentsExportTo);
        if (paymentsExportStatus && paymentsExportStatus !== "ALL") params.set("status", paymentsExportStatus);
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/executions/payments/count${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("fetch count failed");
        const data = await res.json();
        if (!cancelled) setPaymentsExportCount(data.count ?? 0);
      } catch {
        if (!cancelled) setPaymentsExportCount(null);
      } finally {
        if (!cancelled) setPaymentsExportCountLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [paymentsExportDialogOpen, paymentsExportFrom, paymentsExportTo, paymentsExportStatus]);

  // Fetch executions count whenever the executions export dialog is open / filters change
  useEffect(() => {
    if (!execExportDialogOpen) { setExecExportCount(null); return; }
    let cancelled = false;
    setExecExportCountLoading(true);
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem("auth_token");
        const params = new URLSearchParams();
        if (execExportFrom) params.set("from", execExportFrom);
        if (execExportTo) params.set("to", execExportTo);
        if (execExportStatus && execExportStatus !== "ALL") params.set("status", execExportStatus);
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/executions/count${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("fetch count failed");
        const data = await res.json();
        if (!cancelled) setExecExportCount(data.count ?? 0);
      } catch {
        if (!cancelled) setExecExportCount(null);
      } finally {
        if (!cancelled) setExecExportCountLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [execExportDialogOpen, execExportFrom, execExportTo, execExportStatus]);

  const handlePaymentsExport = async () => {
    setIsPaymentsExporting(true);
    setPaymentsExportDialogOpen(false);
    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams();
      if (paymentsExportFrom) params.set("from", paymentsExportFrom);
      if (paymentsExportTo) params.set("to", paymentsExportTo);
      if (paymentsExportStatus && paymentsExportStatus !== "ALL") params.set("status", paymentsExportStatus);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/executions/payments/export-excel${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("فشل التصدير");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let filename = "payments";
      if (paymentsExportStatus && paymentsExportStatus !== "ALL") filename += `-${paymentsExportStatus}`;
      if (paymentsExportFrom && paymentsExportTo) filename += `-${paymentsExportFrom}_${paymentsExportTo}`;
      else if (paymentsExportFrom) filename += `-from-${paymentsExportFrom}`;
      else if (paymentsExportTo) filename += `-to-${paymentsExportTo}`;
      filename += ".xlsx";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "فشل تصدير المدفوعات", description: "حدث خطأ أثناء تصدير الملف" });
    } finally {
      setIsPaymentsExporting(false);
    }
  };

  const handleExecExport = async () => {
    setIsExecExporting(true);
    setExecExportDialogOpen(false);
    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams();
      if (execExportFrom) params.set("from", execExportFrom);
      if (execExportTo) params.set("to", execExportTo);
      if (execExportStatus && execExportStatus !== "ALL") params.set("status", execExportStatus);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/executions/export-excel${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("فشل التصدير");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let filename = "executions";
      if (execExportStatus && execExportStatus !== "ALL") filename += `-${execExportStatus}`;
      if (execExportFrom && execExportTo) filename += `-${execExportFrom}_${execExportTo}`;
      else if (execExportFrom) filename += `-from-${execExportFrom}`;
      else if (execExportTo) filename += `-to-${execExportTo}`;
      filename += ".xlsx";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "فشل تصدير التنفيذات", description: "حدث خطأ أثناء تصدير الملف" });
    } finally {
      setIsExecExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    setPdfExportDialogOpen(false);
    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams();
      if (pdfExportFrom) params.set("from", pdfExportFrom);
      if (pdfExportTo) params.set("to", pdfExportTo);
      if (pdfExportStatus && pdfExportStatus !== "ALL") params.set("status", pdfExportStatus);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/executions/export-summary-pdf${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("فشل التصدير");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let filename = "execution-summary";
      if (pdfExportStatus && pdfExportStatus !== "ALL") filename += `-${pdfExportStatus}`;
      if (pdfExportFrom && pdfExportTo) filename += `-${pdfExportFrom}_${pdfExportTo}`;
      else if (pdfExportFrom) filename += `-from-${pdfExportFrom}`;
      else if (pdfExportTo) filename += `-to-${pdfExportTo}`;
      filename += ".pdf";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "فشل تصدير PDF", description: "حدث خطأ أثناء إنشاء ملف PDF" });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportLogs = async (from: string, to: string) => {
    // Persist the chosen range before exporting
    localStorage.setItem(EXPORT_FROM_KEY, from);
    localStorage.setItem(EXPORT_TO_KEY, to);
    setIsExporting(true);
    setExportDialogOpen(false);
    try {
      const token = localStorage.getItem("auth_token");
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/executions/transfer-order-logs/export${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("فشل التصدير");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let filename = "transfer-order-logs";
      if (from && to) filename += `-${from}_${to}`;
      else if (from) filename += `-from-${from}`;
      else if (to) filename += `-to-${to}`;
      filename += ".xlsx";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "فشل تصدير السجل", description: "حدث خطأ أثناء تصدير الملف" });
    } finally {
      setIsExporting(false);
    }
  };

  // Live clock — refreshes countdown timers every minute
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Scroll highlighted execution row into view when data loads
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [location, highlightRef.current]);

  const { data: executions, isLoading } = useListExecutions({});
  const recordTransferOrderMutation = useRecordTransferOrder();

  // ── Stats (computed from full list, before any filter) ───────────────────
  const stats = {
    ACTIVE:       { count: 0, total: 0, paid: 0 },
    FULL_PAYMENT: { count: 0, total: 0, paid: 0 },
    SETTLEMENT:   { count: 0, total: 0, paid: 0 },
  };
  (executions ?? []).forEach((e) => {
    const key = (["ACTIVE", "FULL_PAYMENT", "SETTLEMENT"].includes(e.status) ? e.status : "ACTIVE") as keyof typeof stats;
    stats[key].count++;
    stats[key].total += e.totalAmount;
    stats[key].paid  += e.paidAmount;
  });
  const pendingTransferCount = (executions ?? []).filter(needsTransferOrder).length;
  const totalTransferOrders = (executions ?? []).reduce((sum, e) => sum + (e.transferOrderCount ?? 0), 0);
  const activeExecutions = (executions ?? []).filter((e) => {
    const norm = ["ACTIVE", "FULL_PAYMENT", "SETTLEMENT"].includes(e.status) ? e.status : "ACTIVE";
    return norm === "ACTIVE";
  });
  const activeTransferOrdersTotal = activeExecutions.reduce((sum, e) => sum + (e.transferOrderCount ?? 0), 0);
  const activeCount = activeExecutions.length;
  const avgTransferOrdersPerActive = activeCount > 0
    ? activeTransferOrdersTotal / activeCount
    : null;

  // Persist statusFilter to localStorage whenever it changes
  useEffect(() => {
    if (statusFilter === null) {
      localStorage.removeItem(STATUS_FILTER_KEY);
    } else {
      localStorage.setItem(STATUS_FILTER_KEY, statusFilter);
    }
  }, [statusFilter]);

  // Persist dateFilter to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(DATE_FILTER_KEY, JSON.stringify(dateFilter));
  }, [dateFilter]);

  const toggleStatus = (s: "ACTIVE" | "FULL_PAYMENT" | "SETTLEMENT" | "PENDING_TRANSFER") =>
    setStatusFilter((prev) => (prev === s ? null : s));

  const handleTransferOrder = async (id: number) => {
    try {
      await recordTransferOrderMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListExecutionsQueryKey({}) });
      queryClient.invalidateQueries({ queryKey: getGetExecutionTransferOrderSummaryQueryKey() });
      toast({ title: "✅ تم تسجيل أمر التحويل بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل تسجيل أمر التحويل" });
    }
  };

  const executionsDateFiltered = filterByDateRange(executions, dateFilter);
  const executionsForSort = statusFilter === "PENDING_TRANSFER"
    ? executionsDateFiltered?.filter(needsTransferOrder)
    : statusFilter
    ? executionsDateFiltered?.filter((e) => {
        const norm = ["ACTIVE", "FULL_PAYMENT", "SETTLEMENT"].includes(e.status) ? e.status : "ACTIVE";
        return norm === statusFilter;
      })
    : executionsDateFiltered;
  const { sorted: sortedExecutions, sortKey, sortDir, toggle } = useSortable(executionsForSort, {
    executionNumber: (e) => e.executionNumber,
    caseId: (e) => e.caseId,
    type: (e) => e.type,
    paidAmount: (e) => e.paidAmount,
    remainingAmount: (e) => e.remainingAmount,
    lastWithdrawalAt: (e) => e.lastWithdrawalAt ?? "",
    status: (e) => e.status,
    createdAt: (e) => e.createdAt,
    lastTransferOrderAt: (e) => e.lastTransferOrderAt ?? "",
    daysSinceLastTransfer: (e) => e.lastTransferOrderAt
      ? Math.floor((Date.now() - new Date(e.lastTransferOrderAt).getTime()) / (1000 * 60 * 60 * 24))
      : Infinity,
    transferOrderCount: (e) => e.transferOrderCount ?? 0,
  }, "executions-sort-prefs");
  const { data: cases } = useListCases({}, { query: { queryKey: getListCasesQueryKey({}) } });
  const createExecution = useCreateExecution();

  const form = useForm<ExecutionFormValues>({
    resolver: zodResolver(executionSchema),
    defaultValues: { caseId: "", executionNumber: "", type: "", totalAmount: "", paidAmount: "" },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListExecutionsQueryKey({}) });

  const onSubmit = async (data: ExecutionFormValues) => {
    try {
      await createExecution.mutateAsync({
        data: {
          caseId: parseInt(data.caseId, 10),
          totalAmount: Number(data.totalAmount),
          paidAmount: data.paidAmount ? Number(data.paidAmount) : 0,
          ...(data.executionNumber ? { executionNumber: data.executionNumber } : {}),
          ...(data.type ? { type: data.type } : {}),
        },
      });
      invalidate();
      toast({ title: "✅ تم إنشاء طلب التنفيذ بنجاح" });
      setIsDialogOpen(false);
      form.reset();
    } catch (err) {
      toast({ variant: "destructive", title: "فشل إنشاء طلب التنفيذ", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">التنفيذ</h2>
            <p className="text-muted-foreground mt-1">متابعة طلبات التنفيذ والتحصيل</p>
          </div>

          {/* ── Actions ── */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* ── Payments (withdrawals) Excel export ── */}
            <Dialog open={paymentsExportDialogOpen} onOpenChange={(v) => { setPaymentsExportDialogOpen(v); if (!v) { setPaymentsExportFrom(""); setPaymentsExportTo(""); setPaymentsExportStatus("ALL"); } }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={isPaymentsExporting}>
                  {isPaymentsExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  تصدير المدفوعات
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm" dir="rtl">
                <DialogHeader>
                  <DialogTitle>تصدير سجل المدفوعات إلى Excel</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <p className="text-sm text-muted-foreground">
                    تصدير سجلات السحوبات (التنفيذات التي بها مبالغ مسدَّدة). حدّد الفلاتر أو اتركها فارغة لتصدير الكل.
                  </p>
                  <div className="space-y-2">
                    <Label>الحالة</Label>
                    <Select value={paymentsExportStatus} onValueChange={setPaymentsExportStatus}>
                      <SelectTrigger dir="rtl">
                        <SelectValue placeholder="جميع الحالات" />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="ALL">جميع الحالات</SelectItem>
                        <SelectItem value="ACTIVE">نشط</SelectItem>
                        <SelectItem value="FULL_PAYMENT">سداد كامل</SelectItem>
                        <SelectItem value="SETTLEMENT">تسوية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payments-export-from">من تاريخ السحب</Label>
                    <Input
                      id="payments-export-from"
                      type="date"
                      dir="ltr"
                      value={paymentsExportFrom}
                      onChange={(e) => setPaymentsExportFrom(e.target.value)}
                      max={paymentsExportTo || undefined}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payments-export-to">إلى تاريخ السحب</Label>
                    <Input
                      id="payments-export-to"
                      type="date"
                      dir="ltr"
                      value={paymentsExportTo}
                      onChange={(e) => setPaymentsExportTo(e.target.value)}
                      min={paymentsExportFrom || undefined}
                    />
                  </div>

                  {/* ── Record count preview ── */}
                  {paymentsExportCountLoading ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>جارٍ حساب عدد السجلات…</span>
                    </div>
                  ) : paymentsExportCount !== null && paymentsExportCount === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <TriangleAlert className="w-4 h-4 shrink-0" />
                      <span>لا توجد سجلات مدفوعات تطابق هذه الفلاتر</span>
                    </div>
                  ) : paymentsExportCount !== null ? (
                    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                      <Download className="w-4 h-4 shrink-0" />
                      <span>سيتم تصدير <strong>{paymentsExportCount.toLocaleString("ar-SA")}</strong> سجل دفع</span>
                    </div>
                  ) : null}
                </div>
                <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground gap-1.5 ml-auto sm:ml-0"
                    onClick={() => { setPaymentsExportFrom(""); setPaymentsExportTo(""); setPaymentsExportStatus("ALL"); }}
                    disabled={!paymentsExportFrom && !paymentsExportTo && paymentsExportStatus === "ALL"}
                  >
                    <X className="w-3.5 h-3.5" />
                    مسح الفلاتر
                  </Button>
                  <Button variant="outline" onClick={() => setPaymentsExportDialogOpen(false)}>
                    إلغاء
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={handlePaymentsExport}
                    disabled={paymentsExportCountLoading || paymentsExportCount === 0}
                  >
                    <Download className="w-4 h-4" />
                    تصدير
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ── Executions Excel export ── */}
            <Dialog open={execExportDialogOpen} onOpenChange={(v) => { setExecExportDialogOpen(v); if (!v) { setExecExportFrom(""); setExecExportTo(""); setExecExportStatus("ALL"); } }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={isExecExporting}>
                  {isExecExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  تصدير التنفيذات
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm" dir="rtl">
                <DialogHeader>
                  <DialogTitle>تصدير التنفيذات إلى Excel</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <p className="text-sm text-muted-foreground">
                    حدّد الفلاتر أدناه. اتركها فارغةً لتصدير جميع التنفيذات.
                  </p>
                  <div className="space-y-2">
                    <Label>الحالة</Label>
                    <Select value={execExportStatus} onValueChange={setExecExportStatus}>
                      <SelectTrigger dir="rtl">
                        <SelectValue placeholder="جميع الحالات" />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="ALL">جميع الحالات</SelectItem>
                        <SelectItem value="ACTIVE">نشط</SelectItem>
                        <SelectItem value="FULL_PAYMENT">سداد كامل</SelectItem>
                        <SelectItem value="SETTLEMENT">تسوية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="exec-export-from">من تاريخ الإنشاء</Label>
                    <Input
                      id="exec-export-from"
                      type="date"
                      dir="ltr"
                      value={execExportFrom}
                      onChange={(e) => setExecExportFrom(e.target.value)}
                      max={execExportTo || undefined}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="exec-export-to">إلى تاريخ الإنشاء</Label>
                    <Input
                      id="exec-export-to"
                      type="date"
                      dir="ltr"
                      value={execExportTo}
                      onChange={(e) => setExecExportTo(e.target.value)}
                      min={execExportFrom || undefined}
                    />
                  </div>

                  {/* ── Record count preview ── */}
                  {execExportCountLoading ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>جارٍ حساب عدد السجلات…</span>
                    </div>
                  ) : execExportCount !== null && execExportCount === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <TriangleAlert className="w-4 h-4 shrink-0" />
                      <span>لا توجد سجلات تطابق هذه الفلاتر</span>
                    </div>
                  ) : execExportCount !== null ? (
                    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                      <Download className="w-4 h-4 shrink-0" />
                      <span>سيتم تصدير <strong>{execExportCount.toLocaleString("ar-SA")}</strong> تنفيذ</span>
                    </div>
                  ) : null}
                </div>
                <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground gap-1.5 ml-auto sm:ml-0"
                    onClick={() => { setExecExportFrom(""); setExecExportTo(""); setExecExportStatus("ALL"); }}
                    disabled={!execExportFrom && !execExportTo && execExportStatus === "ALL"}
                  >
                    <X className="w-3.5 h-3.5" />
                    مسح الفلاتر
                  </Button>
                  <Button variant="outline" onClick={() => setExecExportDialogOpen(false)}>
                    إلغاء
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={handleExecExport}
                    disabled={execExportCountLoading || execExportCount === 0}
                  >
                    <Download className="w-4 h-4" />
                    تصدير
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ── PDF summary export ── */}
            <Dialog open={pdfExportDialogOpen} onOpenChange={(v) => { setPdfExportDialogOpen(v); if (!v) { setPdfExportFrom(""); setPdfExportTo(""); setPdfExportStatus("ALL"); } }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={isExportingPdf}>
                  {isExportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  تصدير PDF
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm" dir="rtl">
                <DialogHeader>
                  <DialogTitle>تصدير ملخص التنفيذات PDF</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <p className="text-sm text-muted-foreground">
                    سيُصدَّر تقرير يحتوي على ملخص المقاييس وجدول التنفيذات بصيغة PDF جاهز للمشاركة.
                  </p>
                  <div className="space-y-2">
                    <Label>الحالة</Label>
                    <Select value={pdfExportStatus} onValueChange={setPdfExportStatus}>
                      <SelectTrigger dir="rtl">
                        <SelectValue placeholder="جميع الحالات" />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="ALL">جميع الحالات</SelectItem>
                        <SelectItem value="ACTIVE">نشط</SelectItem>
                        <SelectItem value="FULL_PAYMENT">سداد كامل</SelectItem>
                        <SelectItem value="SETTLEMENT">تسوية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pdf-export-from">من تاريخ الإنشاء</Label>
                    <Input
                      id="pdf-export-from"
                      type="date"
                      dir="ltr"
                      value={pdfExportFrom}
                      onChange={(e) => setPdfExportFrom(e.target.value)}
                      max={pdfExportTo || undefined}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pdf-export-to">إلى تاريخ الإنشاء</Label>
                    <Input
                      id="pdf-export-to"
                      type="date"
                      dir="ltr"
                      value={pdfExportTo}
                      onChange={(e) => setPdfExportTo(e.target.value)}
                      min={pdfExportFrom || undefined}
                    />
                  </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground gap-1.5 ml-auto sm:ml-0"
                    onClick={() => { setPdfExportFrom(""); setPdfExportTo(""); setPdfExportStatus("ALL"); }}
                    disabled={!pdfExportFrom && !pdfExportTo && pdfExportStatus === "ALL"}
                  >
                    <X className="w-3.5 h-3.5" />
                    مسح الفلاتر
                  </Button>
                  <Button variant="outline" onClick={() => setPdfExportDialogOpen(false)}>
                    إلغاء
                  </Button>
                  <Button className="gap-2" onClick={handleExportPdf}>
                    <FileText className="w-4 h-4" />
                    تصدير PDF
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={exportDialogOpen} onOpenChange={(v) => { setExportDialogOpen(v); if (!v) restoreExportDates(); }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={isExporting}>
                  {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  تصدير السجل
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm" dir="rtl">
                <DialogHeader>
                  <DialogTitle>تصدير سجل أوامر التحويل</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <p className="text-sm text-muted-foreground">
                    حدّد نطاق التاريخ للتصدير. اتركهما فارغَين لتصدير جميع السجلات.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="export-from">من تاريخ</Label>
                    <Input
                      id="export-from"
                      type="date"
                      dir="ltr"
                      value={exportFrom}
                      onChange={(e) => setExportFrom(e.target.value)}
                      max={exportTo || undefined}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="export-to">إلى تاريخ</Label>
                    <Input
                      id="export-to"
                      type="date"
                      dir="ltr"
                      value={exportTo}
                      onChange={(e) => setExportTo(e.target.value)}
                      min={exportFrom || undefined}
                    />
                  </div>

                  {/* ── Record count preview ── */}
                  {exportCountLoading ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>جارٍ حساب عدد السجلات…</span>
                    </div>
                  ) : exportCount !== null && exportCount === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <TriangleAlert className="w-4 h-4 shrink-0" />
                      <span>لا توجد سجلات في هذا النطاق الزمني</span>
                    </div>
                  ) : exportCount !== null ? (
                    <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                      <Download className="w-4 h-4 shrink-0" />
                      <span>سيتم تصدير <strong>{exportCount.toLocaleString("ar-SA")}</strong> سجل</span>
                    </div>
                  ) : null}
                </div>
                <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground gap-1.5 ml-auto sm:ml-0"
                    onClick={() => { setExportFrom(""); setExportTo(""); }}
                    disabled={!exportFrom && !exportTo}
                  >
                    <X className="w-3.5 h-3.5" />
                    مسح التواريخ
                  </Button>
                  <Button variant="outline" onClick={() => { setExportDialogOpen(false); restoreExportDates(); }}>
                    إلغاء
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={() => handleExportLogs(exportFrom, exportTo)}
                    disabled={exportCountLoading || exportCount === 0}
                  >
                    <Download className="w-4 h-4" />
                    تصدير
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

          {/* ── Create dialog ── */}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                إضافة طلب تنفيذ
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md" dir="rtl">
              <DialogHeader>
                <DialogTitle>طلب تنفيذ جديد</DialogTitle>
              </DialogHeader>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Case picker */}
                <div className="space-y-2">
                  <Label>القضية *</Label>
                  {(() => {
                    const caseId = form.watch("caseId");
                    const selected = cases?.find((c) => String(c.id) === caseId);
                    const label = selected
                      ? (selected.caseNumber || `قضية #${selected.id}`) + " — " + (selected.subject || selected.clientName || "")
                      : null;
                    return (
                      <Popover open={caseOpen} onOpenChange={setCaseOpen}>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" role="combobox"
                            className="w-full justify-between font-normal text-right" dir="rtl">
                            <span className={label ? "truncate" : "text-muted-foreground"}>
                              {label ?? "ابحث عن قضية..."}
                            </span>
                            <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0 mr-2" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" dir="rtl" align="start">
                          <Command>
                            <CommandInput placeholder="ابحث برقم أو اسم العميل..." className="text-right" />
                            <CommandList>
                              <CommandEmpty>لا توجد قضية مطابقة</CommandEmpty>
                              {cases?.map((c) => {
                                const itemLabel = (c.caseNumber || `قضية #${c.id}`) + " — " + (c.subject || c.clientName || "");
                                return (
                                  <CommandItem key={c.id} value={itemLabel}
                                    onSelect={() => { form.setValue("caseId", String(c.id), { shouldValidate: true }); setCaseOpen(false); }}
                                    className="flex items-center justify-between cursor-pointer">
                                    <span className="truncate">{itemLabel}</span>
                                    {caseId === String(c.id) && <Check className="w-4 h-4 text-primary shrink-0 ml-2" />}
                                  </CommandItem>
                                );
                              })}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    );
                  })()}
                  {form.formState.errors.caseId && (
                    <p className="text-xs text-destructive">{form.formState.errors.caseId.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-number">رقم التنفيذ</Label>
                  <Input id="exec-number" placeholder="مثال: 447112233" {...form.register("executionNumber")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-type">نوع التنفيذ</Label>
                  <Input id="exec-type" placeholder="مثال: تنفيذ مالي / إخلاء عقار" {...form.register("type")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-total">المبلغ الإجمالي (﷼) *</Label>
                  <Input id="exec-total" type="number" min="0" step="0.01" dir="ltr" {...form.register("totalAmount")} />
                  {form.formState.errors.totalAmount && (
                    <p className="text-xs text-destructive">{form.formState.errors.totalAmount.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exec-paid">المبلغ المسدد الابتدائي (﷼)</Label>
                  <Input id="exec-paid" type="number" min="0" step="0.01" dir="ltr" placeholder="0" {...form.register("paidAmount")} />
                  {form.formState.errors.paidAmount && (
                    <p className="text-xs text-destructive">{form.formState.errors.paidAmount.message}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createExecution.isPending} className="w-full gap-2">
                    {createExecution.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    إنشاء طلب التنفيذ
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* ── Stats cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* ACTIVE */}
          {(() => {
            const active = statusFilter === "ACTIVE";
            return (
              <button
                type="button"
                onClick={() => toggleStatus("ACTIVE")}
                className={[
                  "relative text-right rounded-xl border-2 p-5 transition-all duration-200 shadow-sm group overflow-hidden",
                  "hover:shadow-md hover:-translate-y-0.5",
                  active
                    ? "border-primary bg-primary/10 shadow-primary/20"
                    : "border-border bg-card hover:border-primary/40",
                ].join(" ")}
              >
                {/* glow strip */}
                <div className="absolute top-0 right-0 h-0.5 w-full bg-gradient-to-l from-primary via-primary/40 to-transparent rounded-t-xl" />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-1 tracking-wide">طلبات نشطة</p>
                    <p className={`text-3xl font-bold tabular-nums leading-none ${active ? "text-primary" : "text-foreground"}`}>
                      {stats.ACTIVE.count}
                    </p>
                    <div className="mt-3 space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">
                        الإجمالي: <span className="font-semibold text-foreground">{stats.ACTIVE.total.toLocaleString()} ﷼</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        المسدَّد: <span className="font-semibold text-primary">{stats.ACTIVE.paid.toLocaleString()} ﷼</span>
                      </p>
                    </div>
                  </div>
                  <div className={`rounded-xl p-2.5 transition-colors ${active ? "bg-primary/20" : "bg-primary/10 group-hover:bg-primary/15"}`}>
                    <Activity className={`w-5 h-5 ${active ? "text-primary" : "text-primary/70"}`} />
                  </div>
                </div>

                {active && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">
                    <X className="w-2.5 h-2.5" /> إلغاء الفلتر
                  </span>
                )}
              </button>
            );
          })()}

          {/* FULL_PAYMENT */}
          {(() => {
            const active = statusFilter === "FULL_PAYMENT";
            return (
              <button
                type="button"
                onClick={() => toggleStatus("FULL_PAYMENT")}
                className={[
                  "relative text-right rounded-xl border-2 p-5 transition-all duration-200 shadow-sm group overflow-hidden",
                  "hover:shadow-md hover:-translate-y-0.5",
                  active
                    ? "border-emerald-500 bg-emerald-500/10 shadow-emerald-500/20"
                    : "border-border bg-card hover:border-emerald-400/50",
                ].join(" ")}
              >
                <div className="absolute top-0 right-0 h-0.5 w-full bg-gradient-to-l from-emerald-500 via-emerald-400/40 to-transparent rounded-t-xl" />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-1 tracking-wide">سداد كامل</p>
                    <p className={`text-3xl font-bold tabular-nums leading-none ${active ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                      {stats.FULL_PAYMENT.count}
                    </p>
                    <div className="mt-3 space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">
                        الإجمالي: <span className="font-semibold text-foreground">{stats.FULL_PAYMENT.total.toLocaleString()} ﷼</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        المسدَّد: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{stats.FULL_PAYMENT.paid.toLocaleString()} ﷼</span>
                      </p>
                    </div>
                  </div>
                  <div className={`rounded-xl p-2.5 transition-colors ${active ? "bg-emerald-500/20" : "bg-emerald-500/10 group-hover:bg-emerald-500/15"}`}>
                    <CheckCircle2 className={`w-5 h-5 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-emerald-500/70"}`} />
                  </div>
                </div>

                {active && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">
                    <X className="w-2.5 h-2.5" /> إلغاء الفلتر
                  </span>
                )}
              </button>
            );
          })()}

          {/* SETTLEMENT */}
          {(() => {
            const active = statusFilter === "SETTLEMENT";
            return (
              <button
                type="button"
                onClick={() => toggleStatus("SETTLEMENT")}
                className={[
                  "relative text-right rounded-xl border-2 p-5 transition-all duration-200 shadow-sm group overflow-hidden",
                  "hover:shadow-md hover:-translate-y-0.5",
                  active
                    ? "border-slate-500 bg-slate-500/10 shadow-slate-500/20"
                    : "border-border bg-card hover:border-slate-400/50",
                ].join(" ")}
              >
                <div className="absolute top-0 right-0 h-0.5 w-full bg-gradient-to-l from-slate-500 via-slate-400/40 to-transparent rounded-t-xl" />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-1 tracking-wide">تسوية</p>
                    <p className={`text-3xl font-bold tabular-nums leading-none ${active ? "text-slate-600 dark:text-slate-300" : "text-foreground"}`}>
                      {stats.SETTLEMENT.count}
                    </p>
                    <div className="mt-3 space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">
                        الإجمالي: <span className="font-semibold text-foreground">{stats.SETTLEMENT.total.toLocaleString()} ﷼</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        المسدَّد: <span className="font-semibold text-slate-600 dark:text-slate-300">{stats.SETTLEMENT.paid.toLocaleString()} ﷼</span>
                      </p>
                    </div>
                  </div>
                  <div className={`rounded-xl p-2.5 transition-colors ${active ? "bg-slate-500/20" : "bg-slate-500/10 group-hover:bg-slate-500/15"}`}>
                    <Handshake className={`w-5 h-5 ${active ? "text-slate-600 dark:text-slate-300" : "text-slate-500/70"}`} />
                  </div>
                </div>

                {active && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-medium text-slate-600 dark:text-slate-300 bg-slate-500/10 rounded-full px-2 py-0.5">
                    <X className="w-2.5 h-2.5" /> إلغاء الفلتر
                  </span>
                )}
              </button>
            );
          })()}

          {/* PENDING_TRANSFER — 4th card */}
          {(() => {
            const active = statusFilter === "PENDING_TRANSFER";
            const urgent = pendingTransferCount > 0;
            return (
              <button
                type="button"
                onClick={() => toggleStatus("PENDING_TRANSFER")}
                className={[
                  "relative text-right rounded-xl border-2 p-5 transition-all duration-200 shadow-sm group overflow-hidden",
                  "hover:shadow-md hover:-translate-y-0.5",
                  active
                    ? "border-destructive bg-destructive/10 shadow-destructive/20"
                    : urgent
                    ? "border-orange-400/60 bg-orange-50 dark:bg-orange-950/20 hover:border-destructive/50 animate-pulse-subtle"
                    : "border-border bg-card hover:border-orange-400/40",
                ].join(" ")}
              >
                <div className="absolute top-0 right-0 h-0.5 w-full bg-gradient-to-l from-destructive via-orange-400/40 to-transparent rounded-t-xl" />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-1 tracking-wide">تنتظر أمر تحويل</p>
                    <p className={`text-3xl font-bold tabular-nums leading-none ${active || urgent ? "text-destructive" : "text-foreground"}`}>
                      {pendingTransferCount}
                    </p>
                    <div className="mt-3 space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">
                        {pendingTransferCount === 0
                          ? "جميع الطلبات محدَّثة ✓"
                          : `${pendingTransferCount} طلب بحاجة لأمر تحويل الآن`}
                      </p>
                      <p className="text-[11px] text-muted-foreground opacity-70">كل 7 أيام</p>
                    </div>
                  </div>
                  <div className={`rounded-xl p-2.5 transition-colors ${active ? "bg-destructive/20" : "bg-orange-500/10 group-hover:bg-orange-500/15"}`}>
                    <TriangleAlert className={`w-5 h-5 ${active || urgent ? "text-destructive" : "text-orange-500/70"}`} />
                  </div>
                </div>

                {active && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 rounded-full px-2 py-0.5">
                    <X className="w-2.5 h-2.5" /> إلغاء الفلتر
                  </span>
                )}
              </button>
            );
          })()}

          {/* TOTAL TRANSFER ORDERS — 5th card */}
          <div className="relative text-right rounded-xl border-2 p-5 shadow-sm overflow-hidden border-border bg-card">
            <div className="absolute top-0 right-0 h-0.5 w-full bg-gradient-to-l from-violet-500 via-violet-400/40 to-transparent rounded-t-xl" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1 tracking-wide">إجمالي أوامر التحويل</p>
                <p className="text-3xl font-bold tabular-nums leading-none text-foreground">
                  {totalTransferOrders.toLocaleString()}
                </p>
                <div className="mt-3 space-y-0.5">
                  <p className="text-[11px] text-muted-foreground">
                    عبر{" "}
                    <span className="font-semibold text-foreground">
                      {(executions ?? []).length}
                    </span>{" "}
                    طلب تنفيذ
                  </p>
                  {avgTransferOrdersPerActive !== null ? (
                    <p className="text-[11px] text-muted-foreground">
                      المتوسط:{" "}
                      <span className="font-semibold text-violet-600 dark:text-violet-400">
                        {avgTransferOrdersPerActive.toLocaleString("ar-SA", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </span>{" "}
                      لكل طلب نشط
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground opacity-70">لا توجد طلبات نشطة</p>
                  )}
                </div>
              </div>
              <div className="rounded-xl p-2.5 bg-violet-500/10">
                <ArrowRightLeft className="w-5 h-5 text-violet-500/70" />
              </div>
            </div>
          </div>
        </div>

        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />

        <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <IndexHead />
                <SortableHead label="رقم التنفيذ"  sortKey="executionNumber"  currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="رقم القضية"   sortKey="caseId"           currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="النوع"         sortKey="type"             currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="المبلغ المسدد" sortKey="paidAmount"       currentKey={sortKey} dir={sortDir} onToggle={toggle} className="w-56" />
                <SortableHead label="المتبقي / تحديث" sortKey="remainingAmount"  currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="آخر سحب"         sortKey="lastWithdrawalAt" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الحالة"          sortKey="status"           currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="تاريخ الإنشاء"   sortKey="createdAt"        currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="آخر أمر تحويل"  sortKey="lastTransferOrderAt" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الأيام منذ آخر أمر" sortKey="daysSinceLastTransfer" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="أمر التحويل" sortKey="transferOrderCount" currentKey={sortKey} dir={sortDir} onToggle={toggle} className="min-w-[180px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center h-24">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : sortedExecutions?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center h-32 text-muted-foreground">
                    <Gavel className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    لا توجد طلبات تنفيذ
                  </TableCell>
                </TableRow>
              ) : (
                sortedExecutions?.map((e, idx) => {
                  const progress = e.totalAmount > 0 ? Math.min(100, (e.paidAmount / e.totalAmount) * 100) : 0;
                  const isHighlighted = highlightedId === e.id;
                  return (
                    <TableRow
                      key={e.id}
                      ref={isHighlighted ? highlightRef : null}
                      className={`group hover:bg-muted/30 transition-colors ${isHighlighted ? "ring-2 ring-inset ring-primary bg-primary/10" : ""}`}
                    >
                      <TableCell className="text-muted-foreground font-mono text-sm">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{e.executionNumber || "—"}</TableCell>
                      <TableCell>{e.caseId}</TableCell>
                      <TableCell>{e.type || "—"}</TableCell>

                      {/* Paid amount with progress bar */}
                      <TableCell>
                        <div className="space-y-1">
                          <div className="w-full bg-secondary rounded-full h-1.5">
                            <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              {e.paidAmount.toLocaleString()} ﷼
                            </span>
                            <span>{e.totalAmount.toLocaleString()} ﷼</span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Remaining amount — click pencil to open edit dialog */}
                      <TableCell>
                        <EditDialog
                          execution={{
                            id: e.id,
                            paidAmount: e.paidAmount,
                            totalAmount: e.totalAmount,
                            remainingAmount: e.remainingAmount,
                            status: e.status,
                            lastWithdrawalAt: e.lastWithdrawalAt,
                            lastWithdrawalBy: e.lastWithdrawalBy,
                            executionNumber: e.executionNumber,
                            transferOrderCount: e.transferOrderCount,
                            lastTransferOrderAt: e.lastTransferOrderAt,
                          }}
                          onSuccess={invalidate}
                        />
                      </TableCell>

                      {/* Last withdrawal */}
                      <TableCell>
                        {e.lastWithdrawalAt ? (
                          <div className="space-y-0.5">
                            <div>{fmtDate(e.lastWithdrawalAt)}</div>
                            {e.lastWithdrawalBy && (
                              <div className="text-[10px] text-muted-foreground leading-tight">
                                {e.lastWithdrawalBy}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">لا يوجد</span>
                        )}
                      </TableCell>

                      <TableCell>{getStatusBadge(e.status)}</TableCell>
                      <TableCell>{fmtDate(e.createdAt)}</TableCell>

                      {/* Last transfer order date */}
                      <TableCell>
                        {e.lastTransferOrderAt ? (
                          <span className="text-sm tabular-nums">{fmtDate(e.lastTransferOrderAt)}</span>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">لا يوجد</span>
                        )}
                      </TableCell>

                      {/* Days since last transfer order */}
                      {(() => {
                        const days = e.lastTransferOrderAt
                          ? Math.floor((Date.now() - new Date(e.lastTransferOrderAt).getTime()) / (1000 * 60 * 60 * 24))
                          : null;
                        const isLate = days !== null && days > 7;
                        return (
                          <TableCell
                            className={isLate ? "font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30" : ""}
                          >
                            {days !== null ? (
                              <span className="tabular-nums">{days} يوم</span>
                            ) : (
                              <span className="text-muted-foreground/40 text-xs">—</span>
                            )}
                          </TableCell>
                        );
                      })()}

                      {/* Transfer order column */}
                      <TableCell>
                        {e.status === "FULL_PAYMENT" || e.status === "SETTLEMENT" ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="text-muted-foreground/40 text-xs">—</span>
                            {(e.transferOrderCount ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                                <ArrowRightLeft className="w-3 h-3" />
                                {e.transferOrderCount} أمر مسجّل
                              </span>
                            )}
                          </div>
                        ) : needsTransferOrder(e) ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleTransferOrder(e.id)}
                              disabled={recordTransferOrderMutation.isPending}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 border border-destructive/30 text-destructive text-xs font-semibold transition-all hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {recordTransferOrderMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                              )}
                              أمر تحويل الآن
                            </button>
                            <div className="flex items-center gap-2">
                              {(e.transferOrderCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                                  <ArrowRightLeft className="w-2.5 h-2.5" />
                                  {e.transferOrderCount}
                                </span>
                              )}
                              <TransferOrderLogDialog executionId={e.id} executionNumber={e.executionNumber} />
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleTransferOrder(e.id)}
                              disabled={recordTransferOrderMutation.isPending}
                              className="text-right group/to disabled:opacity-50"
                              title="اضغط لتسجيل أمر تحويل جديد لهذا الأسبوع"
                            >
                              <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                تم هذا الأسبوع
                              </div>
                              {(() => {
                                const cd = getTransferCountdown(e.lastTransferOrderAt!, nowTick);
                                if (!cd) return null;
                                return (
                                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5 group-hover/to:text-primary transition-colors">
                                    <Clock className="w-3 h-3 shrink-0" />
                                    القادم: {cd.days > 0 ? `${cd.days} أيام` : ""}{cd.days > 0 && cd.hours > 0 ? " و" : ""}{cd.hours > 0 ? ` ${cd.hours} ساعة` : cd.days === 0 ? "أقل من ساعة" : ""}
                                  </div>
                                );
                              })()}
                            </button>
                            <div className="flex items-center gap-2">
                              {(e.transferOrderCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                                  <ArrowRightLeft className="w-2.5 h-2.5" />
                                  {e.transferOrderCount}
                                </span>
                              )}
                              <TransferOrderLogDialog executionId={e.id} executionNumber={e.executionNumber} />
                            </div>
                          </div>
                        )}
                      </TableCell>

                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}
