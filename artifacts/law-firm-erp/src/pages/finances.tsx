import React, { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, Plus, Pencil, Trash2,
  Download, FileText, Loader2, CheckCircle2, Clock, BarChart2, ShoppingCart, Receipt,
} from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

// ─── API helper ──────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem("auth_token") ?? ""; }
async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface FinanceStats {
  totalRevenue: number;
  paidRevenue: number;
  totalExpenses: number;
  netProfit: number;
  monthlyRevenue: { month: string; total: number }[];
  monthlyExpenses: { month: string; total: number }[];
}

interface SaleRow {
  contractId: number;
  caseId: number | null;
  caseNumber: string;
  caseSubject: string;
  clientName: string;
  totalFees: number;
  paidAmount: number;
  remainingAmount: number;
  createdAt: string;
}

interface ExpensePayment {
  id: number;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  isPaid: boolean;
  paidAt: string | null;
}

type UserRole = "SYSTEM_MANAGER" | "TECHNICIAN" | "SUPER_ADMIN";

const ROLE_AR: Record<UserRole, string> = {
  SYSTEM_MANAGER: "مدير النظام",
  TECHNICIAN: "موظف",
  SUPER_ADMIN: "المدير العام",
};

interface Expense {
  id: number;
  expenseType: string;
  totalAmount: number;
  installmentsCount: number;
  paymentDurationMonths: number | null;
  singleDueDate: string | null;
  notes: string | null;
  createdByName: string | null;
  createdByRole: UserRole | null;
  createdAt: string;
  payments: ExpensePayment[];
}

// ─── Period filter ───────────────────────────────────────────────────────────
type Period = "all" | "today" | "week" | "month" | "custom";

interface PeriodFilterProps {
  value: Period;
  from: string;
  to: string;
  onChange: (period: Period, from: string, to: string) => void;
}

function PeriodFilter({ value, from, to, onChange }: PeriodFilterProps) {
  const presets: { key: Period; label: string }[] = [
    { key: "all", label: "منذ البداية" },
    { key: "today", label: "اليوم" },
    { key: "week", label: "الأسبوع" },
    { key: "month", label: "الشهر" },
    { key: "custom", label: "مخصص" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2" dir="rtl">
      {presets.map(p => (
        <Button
          key={p.key}
          size="sm"
          variant={value === p.key ? "default" : "outline"}
          onClick={() => onChange(p.key, from, to)}
        >
          {p.label}
        </Button>
      ))}
      {value === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" className="w-40 h-8 text-sm" value={from}
            onChange={e => onChange("custom", e.target.value, to)} />
          <span className="text-muted-foreground text-sm">—</span>
          <Input type="date" className="w-40 h-8 text-sm" value={to}
            onChange={e => onChange("custom", from, e.target.value)} />
        </div>
      )}
    </div>
  );
}

// ─── Number formatters ───────────────────────────────────────────────────────
function formatSAR(n: number) {
  return new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " ر.س";
}

function arabicMonth(ym: string) {
  try {
    const [y, m] = ym.split("-");
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("ar-SA", { month: "short", year: "2-digit" });
  } catch {
    return ym;
  }
}

// ─── Stats Tab ───────────────────────────────────────────────────────────────
function StatsTab({ period, from, to }: { period: Period; from: string; to: string }) {
  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period === "custom") { if (from) params.set("from", from); if (to) params.set("to", to); }
    apiFetch<FinanceStats>(`/api/finances/stats?${params}`)
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period, from, to]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );

  if (!stats) return null;

  // Merge monthly data
  const allMonths = Array.from(new Set([
    ...stats.monthlyRevenue.map(m => m.month),
    ...stats.monthlyExpenses.map(m => m.month),
  ])).sort();
  const chartData = allMonths.map(m => ({
    month: arabicMonth(m),
    revenue: stats.monthlyRevenue.find(r => r.month === m)?.total ?? 0,
    expenses: stats.monthlyExpenses.find(r => r.month === m)?.total ?? 0,
  }));

  const pieData = [
    { name: "الإيرادات", value: stats.totalRevenue, color: "#10b981" },
    { name: "المصروفات", value: stats.totalExpenses, color: "#f43f5e" },
  ];

  return (
    <div className="space-y-6 p-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-800">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
              <TrendingUp className="w-6 h-6 text-emerald-600" />
            </div>
            <div dir="rtl">
              <p className="text-sm text-muted-foreground">إجمالي الإيرادات</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatSAR(stats.totalRevenue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 dark:border-rose-800">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center shrink-0">
              <TrendingDown className="w-6 h-6 text-rose-600" />
            </div>
            <div dir="rtl">
              <p className="text-sm text-muted-foreground">إجمالي المصروفات</p>
              <p className="text-xl font-bold text-rose-700 dark:text-rose-400">{formatSAR(stats.totalExpenses)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-primary/20 ${stats.netProfit >= 0 ? "bg-primary/5" : "bg-orange-50/50 dark:bg-orange-950/20"}`}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${stats.netProfit >= 0 ? "bg-primary/10" : "bg-orange-100 dark:bg-orange-900/40"}`}>
              <Wallet className={`w-6 h-6 ${stats.netProfit >= 0 ? "text-primary" : "text-orange-600"}`} />
            </div>
            <div dir="rtl">
              <p className="text-sm text-muted-foreground">صافي الربح</p>
              <p className={`text-xl font-bold ${stats.netProfit >= 0 ? "text-primary" : "text-orange-700 dark:text-orange-400"}`}>
                {formatSAR(stats.netProfit)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      {chartData.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Area chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base" dir="rtl">الإيرادات والمصروفات الشهرية</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 20, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={70}
                    tickFormatter={(v) => new Intl.NumberFormat("ar-SA", { notation: "compact" }).format(v)} />
                  <Tooltip formatter={(v: number, name) => [formatSAR(v), name === "revenue" ? "إيرادات" : "مصروفات"]} />
                  <Legend formatter={(v) => v === "revenue" ? "إيرادات" : "مصروفات"} />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#colorRevenue)" strokeWidth={2} name="revenue" />
                  <Area type="monotone" dataKey="expenses" stroke="#f43f5e" fill="url(#colorExpenses)" strokeWidth={2} name="expenses" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Pie chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base" dir="rtl">نسبة الإيرادات والمصروفات</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                    dataKey="value" nameKey="name" paddingAngle={3}>
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatSAR(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-sm" dir="rtl">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <BarChart2 className="w-12 h-12 opacity-30" />
            <p dir="rtl">لا توجد بيانات كافية لعرض التقارير في هذه الفترة</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Sales Tab ───────────────────────────────────────────────────────────────
function SalesTab({ period, from, to }: { period: Period; from: string; to: string }) {
  const [, navigate] = useLocation();
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period === "custom") { if (from) params.set("from", from); if (to) params.set("to", to); }
    apiFetch<SaleRow[]>(`/api/finances/sales?${params}`)
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period, from, to]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );

  const totalFees = rows.reduce((s, r) => s + r.totalFees, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paidAmount, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remainingAmount, 0);

  return (
    <div className="p-4 space-y-4">
      {/* Summary mini-cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "إجمالي الأتعاب", value: totalFees, color: "text-foreground" },
          { label: "المحصَّل", value: totalPaid, color: "text-emerald-600" },
          { label: "المتبقي", value: totalRemaining, color: "text-amber-600" },
        ].map(c => (
          <Card key={c.label}>
            <CardContent className="p-4 text-center" dir="rtl">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
              <p className={`font-bold text-base ${c.color}`}>{formatSAR(c.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <ShoppingCart className="w-12 h-12 opacity-30" />
            <p dir="rtl">لا توجد عقود مسجلة بعد</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">#</TableHead>
                <TableHead className="text-right">رقم القضية</TableHead>
                <TableHead className="text-right">الموكل</TableHead>
                <TableHead className="text-right">إجمالي الأتعاب</TableHead>
                <TableHead className="text-right">المدفوع</TableHead>
                <TableHead className="text-right">المتبقي</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, idx) => (
                <TableRow
                  key={r.contractId}
                  className={r.caseId ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                >
                  <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                  <TableCell>
                    {r.caseId ? (
                      <Link
                        href={`/cases/${r.caseId}`}
                        className="font-medium text-sm text-primary underline-offset-2 hover:underline"
                      >
                        {r.caseNumber}
                      </Link>
                    ) : (
                      <span className="font-medium text-sm text-muted-foreground">
                        {r.caseNumber !== "-" ? r.caseNumber : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{r.clientName}</TableCell>
                  <TableCell className="font-medium">{formatSAR(r.totalFees)}</TableCell>
                  <TableCell className="text-emerald-600 font-medium">{formatSAR(r.paidAmount)}</TableCell>
                  <TableCell className="font-medium">
                    <span className={r.remainingAmount > 0 ? "text-amber-600" : "text-emerald-600"}>
                      {formatSAR(r.remainingAmount)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.remainingAmount <= 0 ? (
                      <Badge className="bg-emerald-500 hover:bg-emerald-600 text-xs">مسدَّد</Badge>
                    ) : r.paidAmount > 0 ? (
                      <Badge className="bg-amber-500 hover:bg-amber-600 text-xs">جزئي</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs border-rose-300 text-rose-600">غير مسدَّد</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ─── Expense Form Dialog ──────────────────────────────────────────────────────
interface ExpenseFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: Expense | null;
}

interface InstallmentRow { dueDate: string; amount: string; }

function buildSchedule(count: number, total: number, months: number): InstallmentRow[] {
  const per = +(total / count).toFixed(2);
  const last = +(total - per * (count - 1)).toFixed(2);
  const interval = months / count;
  const today = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + Math.round(interval * (i + 1)));
    return { dueDate: d.toISOString().slice(0, 10), amount: String(i === count - 1 ? last : per) };
  });
}

function ExpenseFormDialog({ open, onClose, onSaved, editing }: ExpenseFormProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [expenseType, setExpenseType] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [installmentsCount, setInstallmentsCount] = useState("1");
  const [paymentDurationMonths, setPaymentDurationMonths] = useState("");
  const [singleDueDate, setSingleDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);

  const count = parseInt(installmentsCount || "1", 10) || 1;
  const isMultiple = count > 1;

  // Reset form on open
  useEffect(() => {
    if (open) {
      if (editing) {
        setExpenseType(editing.expenseType);
        setTotalAmount(String(editing.totalAmount));
        setInstallmentsCount(String(editing.installmentsCount));
        setPaymentDurationMonths(editing.paymentDurationMonths ? String(editing.paymentDurationMonths) : "");
        setSingleDueDate(editing.singleDueDate ?? "");
        setNotes(editing.notes ?? "");
        setInstallments([]);
      } else {
        setExpenseType(""); setTotalAmount(""); setInstallmentsCount("1");
        setPaymentDurationMonths(""); setSingleDueDate(""); setNotes(""); setInstallments([]);
      }
    }
  }, [open, editing]);

  // Auto-generate schedule when inputs change
  useEffect(() => {
    if (!isMultiple) { setInstallments([]); return; }
    const total = parseFloat(totalAmount) || 0;
    const months = parseInt(paymentDurationMonths, 10) || 0;
    if (total > 0 && months > 0 && count > 1) {
      setInstallments(buildSchedule(count, total, months));
    }
  }, [count, totalAmount, paymentDurationMonths, isMultiple]);

  function updateInstallment(idx: number, field: keyof InstallmentRow, value: string) {
    setInstallments(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  }

  function resetSchedule() {
    const total = parseFloat(totalAmount) || 0;
    const months = parseInt(paymentDurationMonths, 10) || 0;
    if (total > 0 && months > 0) setInstallments(buildSchedule(count, total, months));
  }

  const installmentsSum = installments.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const targetTotal = parseFloat(totalAmount) || 0;
  const sumDiff = +(installmentsSum - targetTotal).toFixed(2);
  const sumOk = Math.abs(sumDiff) < 0.01;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseType.trim() || !totalAmount) {
      toast({ variant: "destructive", title: "نوع المصروف والمبلغ مطلوبان" });
      return;
    }
    if (isMultiple && installments.length > 0 && !sumOk) {
      toast({ variant: "destructive", title: `مجموع الدفعات (${installmentsSum.toFixed(2)}) لا يساوي الإجمالي (${targetTotal.toFixed(2)})` });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        expenseType, totalAmount, installmentsCount: count,
        paymentDurationMonths: isMultiple ? (parseInt(paymentDurationMonths, 10) || null) : null,
        singleDueDate: !isMultiple ? (singleDueDate || null) : null,
        notes: notes || null,
      };
      if (isMultiple && installments.length > 0) {
        payload.installments = installments.map((r, i) => ({
          installmentNumber: i + 1,
          dueDate: r.dueDate,
          amount: parseFloat(r.amount) || 0,
        }));
      }

      if (editing) {
        await apiFetch(`/api/finances/expenses/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast({ title: "تم تحديث المصروف" });
      } else {
        await apiFetch("/api/finances/expenses", { method: "POST", body: JSON.stringify(payload) });
        toast({ title: "تم إضافة المصروف وإنشاء جدول الدفعات" });
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "تعديل المصروف" : "إضافة مصروف جديد"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic fields */}
          <div>
            <Label>نوع المصروف <span className="text-destructive">*</span></Label>
            <Input value={expenseType} onChange={e => setExpenseType(e.target.value)}
              placeholder="مثال: إيجار، رواتب، مستلزمات مكتبية..." />
          </div>
          <div>
            <Label>الإجمالي (ر.س) <span className="text-destructive">*</span></Label>
            <Input type="number" min="0" step="0.01" value={totalAmount}
              onChange={e => setTotalAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label>عدد الدفعات</Label>
            <Input type="number" min="1" value={installmentsCount}
              onChange={e => setInstallmentsCount(e.target.value)} />
          </div>

          {/* Single payment due date */}
          {!isMultiple && (
            <div>
              <Label>تاريخ الاستحقاق</Label>
              <Input type="date" value={singleDueDate} onChange={e => setSingleDueDate(e.target.value)} />
            </div>
          )}

          {/* Multiple payments */}
          {isMultiple && (
            <div className="space-y-3">
              <div>
                <Label>مدة السداد الإجمالية (بالأشهر)</Label>
                <Input type="number" min="1" value={paymentDurationMonths}
                  onChange={e => setPaymentDurationMonths(e.target.value)}
                  placeholder="مثال: 12" />
              </div>

              {/* Editable installments table */}
              {installments.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  {/* Header */}
                  <div className="px-3 py-2 bg-muted/60 border-b flex items-center justify-between">
                    <span className="text-xs font-semibold">جدول الدفعات</span>
                    <button type="button" onClick={resetSchedule}
                      className="text-xs text-primary hover:underline">
                      إعادة التوزيع التلقائي
                    </button>
                  </div>

                  {/* Rows */}
                  <div className="divide-y">
                    {installments.map((row, i) => (
                      <div key={i} className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 px-3 py-2">
                        <span className="text-xs font-semibold text-muted-foreground w-14 shrink-0">
                          دفعة {i + 1}
                        </span>
                        <div>
                          <Label className="text-[10px] text-muted-foreground mb-0.5 block">تاريخ الاستحقاق</Label>
                          <Input
                            type="date"
                            className="h-8 text-xs"
                            value={row.dueDate}
                            onChange={e => updateInstallment(i, "dueDate", e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground mb-0.5 block">المبلغ (ر.س)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 text-xs"
                            value={row.amount}
                            onChange={e => updateInstallment(i, "amount", e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Sum indicator */}
                  <div className={`px-3 py-2 border-t flex items-center justify-between text-xs ${sumOk ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-rose-50 dark:bg-rose-950/30"}`}>
                    <span className="text-muted-foreground">المجموع الكلي</span>
                    <span className={`font-bold tabular-nums ${sumOk ? "text-emerald-600" : "text-rose-600"}`}>
                      {installmentsSum.toFixed(2)} ر.س
                      {!sumOk && (
                        <span className="font-normal mr-1">
                          ({sumDiff > 0 ? "+" : ""}{sumDiff.toFixed(2)} عن الإجمالي)
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="ملاحظات اختيارية..." />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
            <Button type="submit" disabled={saving || (isMultiple && installments.length > 0 && !sumOk)}>
              {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              {editing ? "حفظ التعديلات" : "إضافة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Expenses Tab ─────────────────────────────────────────────────────────────
function ExpensesTab({ period, from, to }: { period: Period; from: string; to: string }) {
  const { toast } = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period === "custom") { if (from) params.set("from", from); if (to) params.set("to", to); }
    apiFetch<Expense[]>(`/api/finances/expenses?${params}`)
      .then(setExpenses)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period, from, to]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(e: Expense) {
    try {
      await apiFetch(`/api/finances/expenses/${e.id}`, { method: "DELETE" });
      toast({ title: "تم حذف المصروف" });
      load();
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message });
    } finally {
      setDeleting(null);
    }
  }

  async function handlePay(expense: Expense, payment: ExpensePayment) {
    setPayingId(payment.id);
    try {
      await apiFetch(`/api/finances/expenses/${expense.id}/payments/${payment.id}/pay`, { method: "PATCH" });
      toast({ title: "تم تسجيل الدفعة" });
      load();
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message });
    } finally {
      setPayingId(null);
    }
  }

  function handleExcelExport() {
    const token = getToken();
    const a = document.createElement("a");
    a.href = "/api/finances/expenses/export/excel";
    // Use fetch with auth header instead for download
    fetch("/api/finances/expenses/export/excel", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(res => res.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "expenses.xlsx"; a.click();
      URL.revokeObjectURL(url);
    });
  }

  const totalAll = expenses.reduce((s, e) => s + e.totalAmount, 0);
  const totalPaid = expenses.reduce((s, e) => s + e.payments.filter(p => p.isPaid).reduce((ss, p) => ss + p.amount, 0), 0);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3" dir="rtl">
        <div className="flex items-center gap-3">
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> إضافة مصروف
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExcelExport}>
            <Download className="w-4 h-4" /> تصدير Excel
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
            <FileText className="w-4 h-4" /> طباعة
          </Button>
        </div>
        <div className="flex gap-4 text-sm" dir="rtl">
          <span className="text-muted-foreground">الإجمالي: <span className="font-bold text-foreground">{formatSAR(totalAll)}</span></span>
          <span className="text-muted-foreground">المدفوع: <span className="font-bold text-emerald-600">{formatSAR(totalPaid)}</span></span>
          <span className="text-muted-foreground">المتبقي: <span className="font-bold text-amber-600">{formatSAR(totalAll - totalPaid)}</span></span>
        </div>
      </div>

      {expenses.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Receipt className="w-12 h-12 opacity-30" />
            <p dir="rtl">لا توجد مصروفات مسجلة بعد</p>
            <Button onClick={() => { setEditing(null); setFormOpen(true); }} variant="outline">
              <Plus className="w-4 h-4 ml-2" /> إضافة أول مصروف
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right w-10">#</TableHead>
                <TableHead className="text-right">نوع المصروف</TableHead>
                <TableHead className="text-right">الإجمالي</TableHead>
                <TableHead className="text-right">عدد الدفعات</TableHead>
                <TableHead className="text-right">المدفوع</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">أُضيف بواسطة</TableHead>
                <TableHead className="text-right">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e, idx) => {
                const paidAmount = e.payments.filter(p => p.isPaid).reduce((s, p) => s + p.amount, 0);
                const allPaid = e.payments.length > 0 && e.payments.every(p => p.isPaid);
                const isOpen = expanded === e.id;
                return (
                  <React.Fragment key={e.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : e.id)}
                    >
                      <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{e.expenseType}</p>
                          {e.notes && <p className="text-xs text-muted-foreground truncate max-w-[180px]">{e.notes}</p>}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{formatSAR(e.totalAmount)}</TableCell>
                      <TableCell className="text-center">{e.installmentsCount}</TableCell>
                      <TableCell className="text-emerald-600 font-medium">{formatSAR(paidAmount)}</TableCell>
                      <TableCell>
                        {allPaid ? (
                          <Badge className="bg-emerald-500 hover:bg-emerald-600 text-xs">مكتمل</Badge>
                        ) : paidAmount > 0 ? (
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-xs">جاري</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">معلق</Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={ev => ev.stopPropagation()}>
                        <div dir="rtl">
                          {e.createdByName ? (
                            <>
                              <p className="text-xs font-medium">{e.createdByName}</p>
                              <p className="text-xs text-muted-foreground">
                                {e.createdByRole ? ROLE_AR[e.createdByRole] ?? e.createdByRole : ""}
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">—</p>
                          )}
                          <p className="text-[10px] text-muted-foreground/70 tabular-nums mt-0.5">
                            {new Date(e.createdAt).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}
                            {" "}
                            {new Date(e.createdAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell onClick={ev => ev.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => { setEditing(e); setFormOpen(true); }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleting(e)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Payment schedule sub-rows */}
                    {isOpen && e.payments.length > 0 && (
                      <TableRow key={`${e.id}-payments`} className="bg-muted/20 hover:bg-muted/30">
                        <TableCell colSpan={8} className="py-0">
                          <div className="py-3 px-4">
                            <p className="text-xs font-semibold text-muted-foreground mb-2">جدول الدفعات</p>
                            <div className="space-y-1">
                              {e.payments.map(p => (
                                <div key={p.id} className="flex items-center justify-between text-sm rounded-md px-3 py-1.5 border bg-background">
                                  <div className="flex items-center gap-3">
                                    {p.isPaid ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                    ) : (
                                      <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                                    )}
                                    <span>الدفعة {p.installmentNumber}</span>
                                    <span className="font-medium">{formatSAR(p.amount)}</span>
                                    <span className="text-muted-foreground">— استحقاق: {p.dueDate}</span>
                                    {p.isPaid && p.paidAt && (
                                      <span className="text-xs text-emerald-600">
                                        (سُدِّدت {new Date(p.paidAt).toLocaleDateString("ar-SA")})
                                      </span>
                                    )}
                                  </div>
                                  {!p.isPaid && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                                      disabled={payingId === p.id}
                                      onClick={() => handlePay(e, p)}>
                                      {payingId === p.id
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <CheckCircle2 className="w-3 h-3" />}
                                      تسديد
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <ExpenseFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        editing={editing}
      />

      <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف مصروف "{deleting?.expenseType}"؟ سيتم حذف جميع دفعاته أيضاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleting && handleDelete(deleting)}>
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FinancesPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("stats");
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Gate: managers only
  if (user && user.role !== "SYSTEM_MANAGER") {
    navigate("/dashboard");
    return null;
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-full" dir="rtl">
        {/* Page header */}
        <div className="px-4 pt-4 pb-0 border-b bg-background">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-primary" />
                الإدارة المالية
              </h1>
              <p className="text-sm text-muted-foreground">إدارة إيرادات المكتب ومصروفاته وتقاريره</p>
            </div>
          </div>

          {/* Global period filter — applies to all tabs */}
          <div className="pb-3">
            <PeriodFilter
              value={period}
              from={from}
              to={to}
              onChange={(p, f, t) => { setPeriod(p); setFrom(f); setTo(t); }}
            />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
            <TabsList className="bg-transparent border-0 rounded-none p-0 h-auto gap-0">
              {[
                { value: "stats", label: "التقارير الإحصائية", icon: BarChart2 },
                { value: "sales", label: "المبيعات", icon: TrendingUp },
                { value: "expenses", label: "المصروفات", icon: Receipt },
              ].map(tab => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none gap-2 px-4 pb-2"
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="stats" className="m-0 mt-0">
              <StatsTab period={period} from={from} to={to} />
            </TabsContent>
            <TabsContent value="sales" className="m-0 mt-0">
              <SalesTab period={period} from={from} to={to} />
            </TabsContent>
            <TabsContent value="expenses" className="m-0 mt-0">
              <ExpensesTab period={period} from={from} to={to} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
