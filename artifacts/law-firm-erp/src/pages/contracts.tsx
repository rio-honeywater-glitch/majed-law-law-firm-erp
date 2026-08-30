import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useListContracts,
  useUpdateContract,
  useListClients,
  useGenerateContractPdf,
  useSendContractToClient,
  useUploadSignedContract,
  getListContractsQueryKey,
  type Contract,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useForm, Controller, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Loader2, FileText, FileDown, ExternalLink, Pencil, Trash2, ListPlus, Share2, Upload, CheckCircle2, Clock, ChevronsUpDown, Check, Download, TriangleAlert, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useSortable, SortableHead, IndexHead } from "@/components/ui/sortable-table";
import { HijriDatePicker } from "@/components/ui/hijri-date-picker";
import { DateRangeFilter, filterByDateRange, type DateRangeValue } from "@/components/ui/date-range-filter";

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const feeInstallmentSchema = z.object({
  description: z.string().min(1, "الوصف مطلوب"),
  amount: z.coerce.number().min(0, "المبلغ غير صالح"),
  refundable: z.boolean().default(false),
});

type FeeInstallment = z.infer<typeof feeInstallmentSchema>;

const contractSchema = z.object({
  // Core
  clientId: z.number({ required_error: "الرجاء اختيار العميل" }),
  serviceType: z.enum(["FULL_REP", "PARTIAL_REP", "OBJECTION", "CASSATION_REQUEST", "CONTRACT_DRAFTING", "CONTRACT_REVIEW", "LEGAL_CONTRACT_CREATION", "CONSULTATION"], { required_error: "نوع الخدمة مطلوب" }),
  hijriDate: z.string().min(2, "التاريخ الهجري مطلوب"),
  gregorianDate: z.string().optional().or(z.literal("")),
  // Client supplemental info
  clientNationalId: z.string().optional().or(z.literal("")),
  clientAddress: z.string().optional().or(z.literal("")),
  clientPhone: z.string().optional().or(z.literal("")),
  clientEmail: z.string().optional().or(z.literal("")),
  // Case info
  caseNumber: z.string().optional().or(z.literal("")),
  courtName: z.string().optional().or(z.literal("")),
  caseSubject: z.string().optional().or(z.literal("")),
  representationScope: z.string().optional().or(z.literal("")),
  // Fees
  preamble: z.string().optional().or(z.literal("")),
  fees: z.coerce.number().optional().or(z.literal("")),
  feeInstallments: z.array(feeInstallmentSchema).default([]),
  // Other
  isSigned: z.boolean().default(false),
  customClauses: z.array(z.string().max(2000, "البند طويل جداً (الحد الأقصى 2000 حرف)")).max(50),
});

type ContractFormValues = z.infer<typeof contractSchema>;

const DEFAULT_FORM_VALUES: ContractFormValues = {
  clientId: undefined as any,
  serviceType: "FULL_REP",
  hijriDate: "",
  gregorianDate: "",
  clientNationalId: "",
  clientAddress: "",
  clientPhone: "",
  clientEmail: "",
  caseNumber: "",
  courtName: "",
  caseSubject: "",
  representationScope: "",
  preamble: "",
  fees: undefined as any,
  feeInstallments: [],
  isSigned: false,
  customClauses: [],
};

// ─── FeeInstallmentsEditor ─────────────────────────────────────────────────────

function FeeInstallmentsEditor({ form }: { form: UseFormReturn<ContractFormValues> }) {
  const installments: FeeInstallment[] = form.watch("feeInstallments") ?? [];

  const syncTotal = (next: FeeInstallment[]) => {
    const total = next.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    if (total > 0) form.setValue("fees", total);
  };

  const add = () => {
    const next = [...installments, { description: "", amount: 0, refundable: false }];
    form.setValue("feeInstallments", next, { shouldDirty: true });
  };

  const remove = (idx: number) => {
    const next = installments.filter((_, i) => i !== idx);
    form.setValue("feeInstallments", next, { shouldDirty: true });
    syncTotal(next);
  };

  const update = (idx: number, key: keyof FeeInstallment, value: unknown) => {
    const next = installments.map((item, i) =>
      i === idx ? { ...item, [key]: value } : item
    );
    form.setValue("feeInstallments", next, { shouldDirty: true });
    if (key === "amount") syncTotal(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>جدول الأقساط <span className="text-muted-foreground font-normal">(اختياري)</span></Label>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={add}>
          <Plus className="w-3 h-3" />
          إضافة قسط
        </Button>
      </div>
      {installments.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا توجد أقساط — يظهر المبلغ الإجمالي فقط في العقد.</p>
      ) : (
        <div className="space-y-2 max-h-56 overflow-y-auto pl-1">
          {installments.map((inst, i) => (
            <div key={i} className="flex items-start gap-2 p-3 border rounded-md bg-muted/30">
              <span className="mt-2.5 text-xs font-mono text-muted-foreground shrink-0 w-4 text-center">{i + 1}</span>
              <div className="flex-1 grid grid-cols-2 gap-2">
                <Input
                  value={inst.description}
                  onChange={(e) => update(i, "description", e.target.value)}
                  placeholder="الوصف (مثال: عند توقيع العقد)"
                  className="col-span-2 text-sm"
                />
                <Input
                  type="number"
                  value={inst.amount || ""}
                  onChange={(e) => update(i, "amount", parseFloat(e.target.value) || 0)}
                  placeholder="المبلغ (ريال)"
                  className="text-sm"
                />
                <label className="flex items-center gap-2 text-sm cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={!inst.refundable}
                    onChange={(e) => update(i, "refundable", !e.target.checked)}
                    className="rounded accent-primary"
                  />
                  غير قابل للاسترداد
                </label>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 mt-1 text-destructive hover:text-destructive shrink-0"
                onClick={() => remove(i)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CustomClausesEditor ───────────────────────────────────────────────────────

function CustomClausesEditor({ form }: { form: UseFormReturn<ContractFormValues> }) {
  const clauses = form.watch("customClauses") ?? [];
  const setClauses = (next: string[]) => form.setValue("customClauses", next, { shouldDirty: true });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>بنود إضافية <span className="text-muted-foreground font-normal">(اختياري)</span></Label>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => setClauses([...clauses, ""])}>
          <ListPlus className="w-3.5 h-3.5" />
          إضافة بند
        </Button>
      </div>
      {clauses.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا توجد بنود إضافية.</p>
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto pl-1">
          {clauses.map((clause, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-2.5 text-xs font-mono text-muted-foreground shrink-0 w-5 text-center">{i + 1}</span>
              <Textarea
                value={clause}
                onChange={(e) => {
                  const next = [...clauses];
                  next[i] = e.target.value;
                  setClauses(next);
                }}
                placeholder={`نص البند رقم ${i + 1}`}
                rows={2}
                className="text-sm"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 mt-1 text-destructive hover:text-destructive shrink-0"
                onClick={() => setClauses(clauses.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section divider ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pt-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      {children}
    </div>
  );
}

// ─── ContractForm (shared between create & edit) ───────────────────────────────

type ClientOption = { id: number; name: string; nationalId?: string | null; address?: string | null; phone?: string | null; email?: string | null };

function ContractForm({
  form,
  clients,
  isCreate = false,
  isPending,
  onCancel,
}: {
  form: UseFormReturn<ContractFormValues>;
  clients: ClientOption[];
  isCreate?: boolean;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [clientOpen, setClientOpen] = useState(false);

  const handleClientSelect = (id: number, field: { onChange: (v: number) => void }) => {
    field.onChange(id);
    const client = clients?.find((c) => c.id === id);
    if (client) {
      form.setValue("clientNationalId", client.nationalId ?? "", { shouldDirty: true });
      form.setValue("clientAddress", client.address ?? "", { shouldDirty: true });
      form.setValue("clientPhone", client.phone ?? "", { shouldDirty: true });
      form.setValue("clientEmail", client.email ?? "", { shouldDirty: true });
    }
    setClientOpen(false);
  };

  return (
    <div className="space-y-5 overflow-y-auto max-h-[72vh] px-1 pb-2">
      {/* ── بيانات أساسية ── */}
      <Section title="بيانات أساسية">
        {isCreate && (
          <div className="space-y-2">
            <Label>العميل <span className="text-destructive">*</span></Label>
            <Controller
              control={form.control}
              name="clientId"
              render={({ field }) => {
                const selected = clients?.find((c) => c.id === field.value);
                return (
                  <Popover open={clientOpen} onOpenChange={setClientOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal text-right"
                        dir="rtl"
                      >
                        <span className={selected ? "" : "text-muted-foreground"}>
                          {selected ? selected.name : "ابحث عن عميل..."}
                        </span>
                        <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0 mr-2" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" dir="rtl" align="start">
                      <Command>
                        <CommandInput placeholder="ابحث بالاسم..." className="text-right" />
                        <CommandList>
                          <CommandEmpty>لا يوجد عميل بهذا الاسم</CommandEmpty>
                          {clients?.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={c.name}
                              onSelect={() => handleClientSelect(c.id, field)}
                              className="flex items-center justify-between cursor-pointer"
                            >
                              {c.name}
                              {field.value === c.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                );
              }}
            />
            {form.formState.errors.clientId && <p className="text-sm text-destructive">{form.formState.errors.clientId.message}</p>}
          </div>
        )}

        <div className="space-y-2">
          <Label>نوع الخدمة <span className="text-destructive">*</span></Label>
          <Controller
            control={form.control}
            name="serviceType"
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="w-full text-right" dir="rtl">
                  <SelectValue placeholder="اختر نوع الخدمة" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {Object.entries(serviceTypeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {form.formState.errors.serviceType && <p className="text-sm text-destructive">{form.formState.errors.serviceType.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>التاريخ الهجري <span className="text-destructive">*</span></Label>
            <HijriDatePicker
              value={form.watch("hijriDate")}
              onChange={(v) => form.setValue("hijriDate", v, { shouldValidate: true })}
              hasError={!!form.formState.errors.hijriDate}
            />
            {form.formState.errors.hijriDate && <p className="text-sm text-destructive">{form.formState.errors.hijriDate.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>التاريخ الميلادي</Label>
            <Input
              {...form.register("gregorianDate")}
              placeholder="2026/07/15"
              dir="ltr"
              className="text-left"
            />
          </div>
        </div>
      </Section>

      {/* ── بيانات الموكل التكميلية ── */}
      <Section title="بيانات الموكل التكميلية">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>رقم الهوية / السجل التجاري</Label>
            <Input {...form.register("clientNationalId")} placeholder="10XXXXXXXX" dir="ltr" className="text-left" />
          </div>
          <div className="space-y-2">
            <Label>عنوان الموكل</Label>
            <Input {...form.register("clientAddress")} placeholder="الرياض — حي النزهة" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>رقم الهاتف</Label>
            <Input {...form.register("clientPhone")} placeholder="05XXXXXXXX" dir="ltr" className="text-left" />
          </div>
          <div className="space-y-2">
            <Label>البريد الإلكتروني</Label>
            <Input {...form.register("clientEmail")} placeholder="example@domain.com" dir="ltr" className="text-left" type="email" />
          </div>
        </div>
      </Section>

      {/* ── بيانات القضية ── */}
      <Section title="بيانات القضية (اختياري)">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>رقم القضية</Label>
            <Input {...form.register("caseNumber")} placeholder="4772935070" dir="ltr" className="text-left" />
          </div>
          <div className="space-y-2">
            <Label>المحكمة الناظرة</Label>
            <Input {...form.register("courtName")} placeholder="المحكمة العامة بالرياض" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>موضوع القضية</Label>
          <Input {...form.register("caseSubject")} placeholder="إخلاء عقار، إثبات حق، طلاق..." />
        </div>
        <div className="space-y-2">
          <Label>نطاق التوكيل</Label>
          <Input {...form.register("representationScope")} placeholder="حتى صدور حكم نهائي فيها" />
        </div>
      </Section>

      {/* ── الأتعاب ── */}
      <Section title="الأتعاب">
        <div className="space-y-2">
          <Label>إجمالي الأتعاب (ريال سعودي)</Label>
          <Input
            {...form.register("fees")}
            type="number"
            placeholder="يحتسب تلقائياً من الأقساط — أو أدخله يدوياً"
            dir="ltr"
            className="text-left"
          />
        </div>
        <FeeInstallmentsEditor form={form} />
      </Section>

      {/* ── البنود الإضافية ── */}
      <Section title="البنود الإضافية">
        <CustomClausesEditor form={form} />
      </Section>

      {/* ── Actions ── */}
      <div className="flex justify-end gap-2 pt-3 border-t sticky bottom-0 bg-background pb-1">
        <Button type="button" variant="outline" onClick={onCancel}>إلغاء</Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (isCreate ? "حفظ العقد" : "حفظ التعديلات")}
        </Button>
      </div>
    </div>
  );
}

// ─── Service type labels ────────────────────────────────────────────────────────

const serviceTypeLabels: Record<string, string> = {
  FULL_REP: "تمثيل كامل",
  PARTIAL_REP: "تمثيل جزئي",
  OBJECTION: "اعتراض",
  CASSATION_REQUEST: "طلب تمييز",
  CONTRACT_DRAFTING: "صياغة عقد",
  CONTRACT_REVIEW: "مراجعة عقد",
  LEGAL_CONTRACT_CREATION: "إنشاء عقد قانوني",
  CONSULTATION: "استشارة",
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Contracts() {
  const [, setLocation] = useLocation();
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [dateFilter, setDateFilter] = useState<DateRangeValue>({ preset: "all" });
  const { isManager, token } = useAuth();

  const { data: contracts, isLoading } = useListContracts({});
  const contractsForSort = filterByDateRange(contracts as any, dateFilter) as typeof contracts;
  const { sorted: sortedContracts, sortKey, sortDir, toggle } = useSortable(contractsForSort, {
    clientName: (c) => c.clientName,
    serviceType: (c) => serviceTypeLabels[c.serviceType] || c.serviceType,
    hijriDate: (c) => c.hijriDate,
    isSigned: (c) => c.isSigned,
    fees: (c) => c.fees,
  });
  const { data: clients } = useListClients({});

  const updateContract = useUpdateContract();
  const generatePdf = useGenerateContractPdf();
  const sendContract = useSendContractToClient();
  const uploadSigned = useUploadSignedContract();
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [togglingSignId, setTogglingSignId] = useState<number | null>(null);
  const [uploadingSignedId, setUploadingSignedId] = useState<number | null>(null);
  const [whatsappLoadingId, setWhatsappLoadingId] = useState<number | null>(null);
  const signedFileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadContractId = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Installments export dialog state ─────────────────────────────────────────
  const [instExportDialogOpen, setInstExportDialogOpen] = useState(false);
  const [instExportFrom, setInstExportFrom] = useState("");
  const [instExportTo, setInstExportTo] = useState("");
  const [instExportCount, setInstExportCount] = useState<number | null>(null);
  const [instExportCountLoading, setInstExportCountLoading] = useState(false);
  const [isInstExporting, setIsInstExporting] = useState(false);

  // Fetch installments count when dialog opens or dates change
  useEffect(() => {
    if (!instExportDialogOpen) { setInstExportCount(null); return; }
    let cancelled = false;
    const fetchCount = async () => {
      setInstExportCountLoading(true);
      try {
        const params = new URLSearchParams();
        if (instExportFrom) params.set("from", instExportFrom);
        if (instExportTo) params.set("to", instExportTo);
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/contracts/installments/count${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("fetch count failed");
        const data = await res.json();
        if (!cancelled) setInstExportCount(data.count ?? 0);
      } catch {
        if (!cancelled) setInstExportCount(null);
      } finally {
        if (!cancelled) setInstExportCountLoading(false);
      }
    };
    fetchCount();
    return () => { cancelled = true; };
  }, [instExportDialogOpen, instExportFrom, instExportTo, token]);

  const handleInstExport = async () => {
    setIsInstExporting(true);
    setInstExportDialogOpen(false);
    try {
      const params = new URLSearchParams();
      if (instExportFrom) params.set("from", instExportFrom);
      if (instExportTo) params.set("to", instExportTo);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/contracts/installments/export-excel${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("فشل التصدير");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let filename = "installments";
      if (instExportFrom && instExportTo) filename += `-${instExportFrom}_${instExportTo}`;
      else if (instExportFrom) filename += `-from-${instExportFrom}`;
      else if (instExportTo) filename += `-to-${instExportTo}`;
      filename += ".xlsx";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "فشل تصدير الأقساط", description: "حدث خطأ أثناء تصدير الملف" });
    } finally {
      setIsInstExporting(false);
    }
  };

  const openPdf = async (pdfUrl: string) => {
    try {
      const res = await fetch(pdfUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      toast({ variant: "destructive", title: "تعذر فتح ملف PDF" });
    }
  };

  const handleGeneratePdf = (contractId: number) => {
    setGeneratingId(contractId);
    generatePdf.mutate(
      { id: contractId },
      {
        onSuccess: ({ pdfUrl }) => {
          queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
          toast({ title: "✅ تم توليد العقد بنجاح" });
          void openPdf(pdfUrl);
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "فشل توليد ملف PDF. يرجى المحاولة مرة أخرى.";
          toast({ variant: "destructive", title: msg });
        },
        onSettled: () => setGeneratingId(null),
      },
    );
  };

  const handleSendToClient = (contractId: number) => {
    setSendingId(contractId);
    sendContract.mutate(
      { id: contractId },
      {
        onSuccess: ({ sentTo }) => {
          toast({ title: "✅ تم إرسال العقد بنجاح", description: `أُرسل إلى: ${sentTo}` });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "فشل إرسال العقد. يرجى المحاولة مرة أخرى.";
          toast({ variant: "destructive", title: msg });
        },
        onSettled: () => setSendingId(null),
      },
    );
  };

  const handleToggleSign = (c: Contract) => {
    setTogglingSignId(c.id);
    updateContract.mutate(
      { id: c.id, data: { isSigned: !c.isSigned } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
          toast({ title: c.isSigned ? "تم تعيين العقد كـ غير موقع" : "✅ تم تعيين العقد كـ موقع" });
        },
        onError: () => toast({ variant: "destructive", title: "تعذّر تحديث حالة التوقيع" }),
        onSettled: () => setTogglingSignId(null),
      },
    );
  };

  const handleUploadSignedClick = (contractId: number) => {
    pendingUploadContractId.current = contractId;
    signedFileInputRef.current?.click();
  };

  const handleShareContract = async (c: Contract) => {
    if (!c.pdfUrl) return;
    setWhatsappLoadingId(c.id);
    try {
      const res = await fetch(c.pdfUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = `عقد-${c.clientName ?? c.id}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });
      const shareData: ShareData = {
        title: `عقد خدمة — ${c.clientName ?? ""}`,
        text: "السلام عليكم، مرفق عقد الخدمة القانونية للمراجعة والتوقيع. شكراً لكم.",
        files: [file],
      };
      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        toast({ title: "📥 تم تحميل ملف العقد", description: "متصفحك لا يدعم المشاركة المباشرة." });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ variant: "destructive", title: "تعذّرت مشاركة ملف PDF" });
      }
    } finally {
      setWhatsappLoadingId(null);
    }
  };

  const handleSignedFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const contractId = pendingUploadContractId.current;
    if (!file || !contractId) return;
    e.target.value = "";
    setUploadingSignedId(contractId);
    uploadSigned.mutate(
      { id: contractId, data: { file } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
          toast({ title: "✅ تم رفع العقد الموقع بنجاح" });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "فشل رفع الملف. يرجى المحاولة مرة أخرى.";
          toast({ variant: "destructive", title: msg });
        },
        onSettled: () => setUploadingSignedId(null),
      },
    );
  };

  // ── Forms ──
  const editForm = useForm<ContractFormValues>({
    resolver: zodResolver(contractSchema),
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const cleanClauses = (clauses: string[]) => clauses.map((c) => c.trim()).filter((c) => c.length > 0);

  const buildPayload = (data: ContractFormValues) => ({
    clientId: data.clientId,
    serviceType: data.serviceType,
    hijriDate: data.hijriDate,
    gregorianDate: data.gregorianDate || undefined,
    clientNationalId: data.clientNationalId || undefined,
    clientAddress: data.clientAddress || undefined,
    clientPhone: data.clientPhone || undefined,
    clientEmail: data.clientEmail || undefined,
    caseNumber: data.caseNumber || undefined,
    courtName: data.courtName || undefined,
    caseSubject: data.caseSubject || undefined,
    representationScope: data.representationScope || undefined,
    preamble: data.preamble || undefined,
    fees: data.fees === "" ? undefined : (data.fees as number | undefined),
    feeInstallments: data.feeInstallments.length > 0 ? data.feeInstallments : undefined,
    isSigned: data.isSigned,
    customClauses: cleanClauses(data.customClauses),
  });

  const openEdit = (c: Contract) => {
    const installments = Array.isArray((c as any).feeInstallments) ? (c as any).feeInstallments : [];
    editForm.reset({
      clientId: c.clientId,
      serviceType: c.serviceType as ContractFormValues["serviceType"],
      hijriDate: c.hijriDate,
      gregorianDate: (c as any).gregorianDate ?? "",
      clientNationalId: (c as any).clientNationalId ?? "",
      clientAddress: (c as any).clientAddress ?? "",
      clientPhone: (c as any).clientPhone ?? "",
      clientEmail: (c as any).clientEmail ?? "",
      caseNumber: (c as any).caseNumber ?? "",
      courtName: (c as any).courtName ?? "",
      caseSubject: (c as any).caseSubject ?? "",
      representationScope: (c as any).representationScope ?? "",
      preamble: c.preamble ?? "",
      fees: c.fees ?? undefined,
      feeInstallments: installments,
      isSigned: c.isSigned,
      customClauses: c.customClauses ?? [],
    });
    setEditingContract(c);
  };

  const onEditSubmit = async (data: ContractFormValues) => {
    if (!editingContract) return;
    try {
      const payload = buildPayload(data);
      await updateContract.mutateAsync({ id: editingContract.id, data: payload as any });
      queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      setEditingContract(null);
      toast({ title: "✅ تم تحديث العقد", description: "أعد توليد ملف PDF لتشمل النسخة الجديدة التعديلات." });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ أثناء تحديث العقد" });
    }
  };

  // ── Render ──
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">العقود</h2>
            <p className="text-muted-foreground mt-1">إدارة العقود القانونية والاتفاقيات</p>
          </div>

          {isManager && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* ── Installments Excel export ── */}
              <Dialog open={instExportDialogOpen} onOpenChange={(v) => { setInstExportDialogOpen(v); if (!v) { setInstExportFrom(""); setInstExportTo(""); } }}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2" disabled={isInstExporting}>
                    {isInstExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    تصدير الأقساط
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm" dir="rtl">
                  <DialogHeader>
                    <DialogTitle>تصدير أقساط الأتعاب إلى Excel</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <p className="text-sm text-muted-foreground">
                      تصدير تفاصيل أقساط الأتعاب لجميع العقود التي تحتوي على جدول دفعات. اتركهما فارغَين لتصدير الكل.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="inst-export-from">من تاريخ الإنشاء</Label>
                      <Input
                        id="inst-export-from"
                        type="date"
                        dir="ltr"
                        value={instExportFrom}
                        onChange={(e) => setInstExportFrom(e.target.value)}
                        max={instExportTo || undefined}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="inst-export-to">إلى تاريخ الإنشاء</Label>
                      <Input
                        id="inst-export-to"
                        type="date"
                        dir="ltr"
                        value={instExportTo}
                        onChange={(e) => setInstExportTo(e.target.value)}
                        min={instExportFrom || undefined}
                      />
                    </div>

                    {/* ── Record count preview ── */}
                    {instExportCountLoading ? (
                      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>جارٍ حساب عدد الأقساط…</span>
                      </div>
                    ) : instExportCount !== null && instExportCount === 0 ? (
                      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        <TriangleAlert className="w-4 h-4 shrink-0" />
                        <span>لا توجد أقساط تطابق هذه الفلاتر</span>
                      </div>
                    ) : instExportCount !== null ? (
                      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                        <Download className="w-4 h-4 shrink-0" />
                        <span>سيتم تصدير <strong>{instExportCount.toLocaleString("ar-SA")}</strong> قسط</span>
                      </div>
                    ) : null}
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground gap-1.5 ml-auto sm:ml-0"
                      onClick={() => { setInstExportFrom(""); setInstExportTo(""); }}
                      disabled={!instExportFrom && !instExportTo}
                    >
                      <X className="w-3.5 h-3.5" />
                      مسح التواريخ
                    </Button>
                    <Button variant="outline" onClick={() => setInstExportDialogOpen(false)}>
                      إلغاء
                    </Button>
                    <Button
                      className="gap-2"
                      onClick={handleInstExport}
                      disabled={instExportCount === 0}
                    >
                      <Download className="w-4 h-4" />
                      تصدير
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button className="gap-2 shadow-sm" onClick={() => setLocation("/contracts/new")}>
                <Plus className="w-4 h-4" />
                إنشاء عقد جديد
              </Button>
            </div>
          )}
        </div>

        <input
          ref={signedFileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleSignedFileChange}
        />

        <DateRangeFilter
          value={dateFilter}
          onChange={setDateFilter}
        />

        <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <IndexHead />
                <SortableHead label="العميل" sortKey="clientName" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="نوع الخدمة" sortKey="serviceType" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="التاريخ الهجري" sortKey="hijriDate" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="حالة التوقيع" sortKey="isSigned" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الأتعاب" sortKey="fees" currentKey={sortKey} dir={sortDir} onToggle={toggle} className="text-left" />
                {isManager && <TableHead className="text-center w-56">العقد (PDF)</TableHead>}
                {isManager && <TableHead className="text-center w-44">العقد الموقع</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isManager ? 8 : 6} className="text-center h-24">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : contracts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isManager ? 8 : 6} className="text-center h-32 text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    لا توجد عقود مسجلة
                  </TableCell>
                </TableRow>
              ) : (
                sortedContracts?.map((c, idx) => (
                  <TableRow key={c.id} className="group hover:bg-muted/30">
                    <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell className="font-medium">
                      <div>{c.clientName}</div>
                      {(c as any).caseNumber && (
                        <div className="text-xs text-muted-foreground font-mono">ق: {(c as any).caseNumber}</div>
                      )}
                    </TableCell>
                    <TableCell>{serviceTypeLabels[c.serviceType] || c.serviceType}</TableCell>
                    <TableCell>
                      <div>{c.hijriDate}</div>
                      {(c as any).gregorianDate && (
                        <div className="text-xs text-muted-foreground">{(c as any).gregorianDate}م</div>
                      )}
                    </TableCell>

                    <TableCell>
                      {isManager ? (
                        <button
                          type="button"
                          title={c.isSigned ? "انقر لتعيينه كـ غير موقع" : "انقر لتعيينه كـ موقع"}
                          disabled={togglingSignId === c.id}
                          onClick={() => handleToggleSign(c)}
                          className="focus:outline-none"
                        >
                          {togglingSignId === c.id ? (
                            <Badge variant="outline" className="gap-1 cursor-wait">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              جارٍ التحديث…
                            </Badge>
                          ) : c.isSigned ? (
                            <Badge className="bg-emerald-500 hover:bg-emerald-600 gap-1 cursor-pointer transition-colors">
                              <CheckCircle2 className="w-3 h-3" />
                              موقع
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-600 hover:bg-amber-50 gap-1 cursor-pointer transition-colors">
                              <Clock className="w-3 h-3" />
                              غير موقع
                            </Badge>
                          )}
                        </button>
                      ) : c.isSigned ? (
                        <Badge className="bg-emerald-500">موقع</Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-600">غير موقع</Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-left font-mono">
                      {isManager
                        ? c.fees
                          ? `${c.fees.toLocaleString()} ﷼`
                          : "-"
                        : "—"}
                    </TableCell>

                    {isManager && (
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs gap-1"
                            title="تعديل العقد"
                            onClick={() => openEdit(c)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            تعديل
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 px-3 text-xs gap-1.5 bg-primary/90 hover:bg-primary text-primary-foreground"
                            onClick={() => handleGeneratePdf(c.id)}
                            disabled={generatingId === c.id}
                          >
                            {generatingId === c.id ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" />جارٍ التوليد…</>
                            ) : (
                              <><FileDown className="w-3.5 h-3.5" />توليد PDF</>
                            )}
                          </Button>
                          {c.pdfUrl && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs gap-1"
                              title="فتح آخر نسخة PDF"
                              onClick={() => void openPdf(c.pdfUrl!)}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              فتح
                            </Button>
                          )}
                          {c.pdfUrl && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs gap-1 border-emerald-500/50 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40"
                              title="مشاركة العقد"
                              disabled={whatsappLoadingId === c.id}
                              onClick={() => void handleShareContract(c)}
                            >
                              {whatsappLoadingId === c.id ? (
                                <><Loader2 className="w-3.5 h-3.5 animate-spin" />جارٍ التحضير…</>
                              ) : (
                                <><Share2 className="w-3.5 h-3.5" />مشاركة</>
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}

                    {isManager && (
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs gap-1"
                            title="رفع نسخة العقد الموقع (PDF)"
                            disabled={uploadingSignedId === c.id}
                            onClick={() => handleUploadSignedClick(c.id)}
                          >
                            {uploadingSignedId === c.id ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" />جارٍ الرفع…</>
                            ) : (
                              <><Upload className="w-3.5 h-3.5" />{c.signedPdfUrl ? "استبدال" : "رفع موقّع"}</>
                            )}
                          </Button>
                          {c.signedPdfUrl && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs gap-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                              title="عرض العقد الموقع"
                              onClick={() => void openPdf(c.signedPdfUrl!)}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              عرض
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Edit Dialog */}
        {isManager && (
          <Dialog open={!!editingContract} onOpenChange={(open) => { if (!open) setEditingContract(null); }}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  تعديل العقد{editingContract ? ` — ${editingContract.clientName ?? ""}` : ""}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="pt-2">
                <ContractForm
                  form={editForm}
                  clients={clients ?? []}
                  isPending={updateContract.isPending}
                  onCancel={() => setEditingContract(null)}
                />
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </AppLayout>
  );
}
