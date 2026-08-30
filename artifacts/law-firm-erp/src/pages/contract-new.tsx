import { useState } from "react";
import { useLocation } from "wouter";
import {
  useCreateContract,
  useListClients,
  getListContractsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRight, Plus, Trash2, ListPlus, Loader2, User, Gavel, Banknote, FileText, ScrollText,
  CheckCircle2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { HijriDatePicker } from "@/components/ui/hijri-date-picker";

// ─── Schema ──────────────────────────────────────────────────────────────────

const feeInstallmentSchema = z.object({
  description: z.string().min(1, "الوصف مطلوب"),
  amount: z.coerce.number().min(0, "المبلغ غير صالح"),
  refundable: z.boolean().default(false),
});
type FeeInstallment = z.infer<typeof feeInstallmentSchema>;

const contractSchema = z.object({
  clientId: z.number({ required_error: "الرجاء اختيار العميل" }),
  serviceType: z.enum([
    "FULL_REP", "PARTIAL_REP", "OBJECTION", "CASSATION_REQUEST",
    "CONTRACT_DRAFTING", "CONTRACT_REVIEW", "LEGAL_CONTRACT_CREATION", "CONSULTATION",
  ], { required_error: "نوع الخدمة مطلوب" }),
  hijriDate: z.string().min(2, "التاريخ الهجري مطلوب"),
  gregorianDate: z.string().optional().or(z.literal("")),
  clientNationalId: z.string().optional().or(z.literal("")),
  clientAddress: z.string().optional().or(z.literal("")),
  clientPhone: z.string().optional().or(z.literal("")),
  clientEmail: z.string().optional().or(z.literal("")),
  caseNumber: z.string().optional().or(z.literal("")),
  courtName: z.string().optional().or(z.literal("")),
  caseSubject: z.string().optional().or(z.literal("")),
  representationScope: z.string().optional().or(z.literal("")),
  preamble: z.string().optional().or(z.literal("")),
  fees: z.coerce.number().optional().or(z.literal("")),
  feeInstallments: z.array(feeInstallmentSchema).default([]),
  isSigned: z.boolean().default(false),
  customClauses: z.array(z.string().max(2000)).max(50),
});
type ContractFormValues = z.infer<typeof contractSchema>;

const DEFAULT_VALUES: ContractFormValues = {
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

const SERVICE_TYPE_LABELS: Record<string, string> = {
  FULL_REP: "تمثيل كامل",
  PARTIAL_REP: "تمثيل جزئي",
  OBJECTION: "اعتراض",
  CASSATION_REQUEST: "طلب تمييز",
  CONTRACT_DRAFTING: "صياغة عقد",
  CONTRACT_REVIEW: "مراجعة عقد",
  LEGAL_CONTRACT_CREATION: "إنشاء عقد قانوني",
  CONSULTATION: "استشارة",
};

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b bg-muted/20">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6 space-y-5">{children}</div>
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

function Field({
  label,
  required,
  error,
  children,
  full,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive mr-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Fee Installments ────────────────────────────────────────────────────────

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
    const next = installments.map((item, i) => (i === idx ? { ...item, [key]: value } : item));
    form.setValue("feeInstallments", next, { shouldDirty: true });
    if (key === "amount") syncTotal(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          جدول الأقساط{" "}
          <span className="text-muted-foreground font-normal">(اختياري)</span>
        </Label>
        <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs gap-1.5" onClick={add}>
          <Plus className="w-3.5 h-3.5" />
          إضافة قسط
        </Button>
      </div>
      {installments.length === 0 ? (
        <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-3 text-center">
          لا توجد أقساط — يظهر المبلغ الإجمالي فقط في العقد
        </p>
      ) : (
        <div className="space-y-2">
          {installments.map((inst, i) => (
            <div key={i} className="grid grid-cols-[1.5rem_1fr_auto_auto_auto] items-center gap-2 p-3 border rounded-lg bg-muted/20">
              <span className="text-xs font-mono text-muted-foreground text-center">{i + 1}</span>
              <Input
                value={inst.description}
                onChange={(e) => update(i, "description", e.target.value)}
                placeholder="الوصف (مثال: عند توقيع العقد)"
                className="text-sm h-8"
              />
              <Input
                type="number"
                value={inst.amount || ""}
                onChange={(e) => update(i, "amount", parseFloat(e.target.value) || 0)}
                placeholder="المبلغ ﷼"
                className="text-sm h-8 w-28"
                dir="ltr"
              />
              <label className="flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={!inst.refundable}
                  onChange={(e) => update(i, "refundable", !e.target.checked)}
                  className="rounded accent-primary"
                />
                غير قابل للاسترداد
              </label>
              <Button
                type="button" size="icon" variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
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

// ─── Custom Clauses ───────────────────────────────────────────────────────────

function CustomClausesEditor({ form }: { form: UseFormReturn<ContractFormValues> }) {
  const clauses = form.watch("customClauses") ?? [];
  const setClauses = (next: string[]) => form.setValue("customClauses", next, { shouldDirty: true });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          البنود الإضافية{" "}
          <span className="text-muted-foreground font-normal">(اختياري)</span>
        </Label>
        <Button
          type="button" size="sm" variant="outline"
          className="h-8 px-3 text-xs gap-1.5"
          onClick={() => setClauses([...clauses, ""])}
        >
          <ListPlus className="w-3.5 h-3.5" />
          إضافة بند
        </Button>
      </div>
      {clauses.length === 0 ? (
        <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-3 text-center">
          لا توجد بنود إضافية — ستُدرج البنود القياسية فقط في العقد
        </p>
      ) : (
        <div className="space-y-2">
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
                type="button" size="icon" variant="ghost"
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

// ─── Summary Sidebar ──────────────────────────────────────────────────────────

function SummarySidebar({
  form,
  clients,
}: {
  form: UseFormReturn<ContractFormValues>;
  clients: Array<{ id: number; name: string }>;
}) {
  const clientId = form.watch("clientId");
  const serviceType = form.watch("serviceType");
  const hijriDate = form.watch("hijriDate");
  const fees = form.watch("fees");
  const installments = form.watch("feeInstallments") ?? [];
  const customClauses = form.watch("customClauses") ?? [];

  const selectedClient = clients.find((c) => c.id === clientId);
  const installmentsTotal = installments.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const displayFees = installmentsTotal > 0 ? installmentsTotal : (Number(fees) || 0);

  const items = [
    { label: "العميل", value: selectedClient?.name, empty: "لم يُحدَّد بعد" },
    { label: "نوع الخدمة", value: SERVICE_TYPE_LABELS[serviceType], empty: "—" },
    { label: "التاريخ الهجري", value: hijriDate || null, empty: "—" },
    {
      label: "إجمالي الأتعاب",
      value: displayFees > 0 ? `${displayFees.toLocaleString()} ﷼` : null,
      empty: "—",
    },
    {
      label: "عدد الأقساط",
      value: installments.length > 0 ? `${installments.length} قسط` : null,
      empty: "بدون جدول أقساط",
    },
    {
      label: "البنود الإضافية",
      value: customClauses.filter(Boolean).length > 0
        ? `${customClauses.filter(Boolean).length} بند`
        : null,
      empty: "بدون بنود إضافية",
    },
  ];

  return (
    <div className="space-y-4 sticky top-6">
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/20">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            ملخص العقد
          </h3>
        </div>
        <div className="divide-y">
          {items.map((item) => (
            <div key={item.label} className="flex justify-between items-center px-5 py-3 gap-3">
              <span className="text-xs text-muted-foreground shrink-0">{item.label}</span>
              <span className={`text-xs font-medium text-left truncate ${!item.value ? "text-muted-foreground/50 italic" : ""}`}>
                {item.value ?? item.empty}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground mb-2">تنبيهات</p>
        <p>• يمكن توليد PDF العقد بعد الحفظ من صفحة العقود</p>
        <p>• إذا أُدخلت أقساط يُحسب الإجمالي تلقائياً</p>
        <p>• البيانات التكميلية للموكل تُملأ تلقائياً عند اختياره</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContractNew() {
  const [, setLocation] = useLocation();
  const [clientOpen, setClientOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createContract = useCreateContract();
  const { data: clients = [] } = useListClients({});

  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const handleClientSelect = (id: number) => {
    form.setValue("clientId", id, { shouldValidate: true });
    const client = clients.find((c) => c.id === id);
    if (client) {
      form.setValue("clientNationalId", (client as any).nationalId ?? "");
      form.setValue("clientAddress", (client as any).address ?? "");
      form.setValue("clientPhone", (client as any).phone ?? "");
      form.setValue("clientEmail", (client as any).email ?? "");
    }
    setClientOpen(false);
  };

  const cleanClauses = (clauses: string[]) =>
    clauses.map((c) => c.trim()).filter((c) => c.length > 0);

  const onSubmit = async (data: ContractFormValues) => {
    try {
      await createContract.mutateAsync({
        data: {
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
        } as any,
      });
      queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      toast({ title: "✅ تم إنشاء العقد بنجاح", description: "يمكنك الآن توليد ملف PDF من صفحة العقود." });
      setLocation("/contracts");
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ أثناء إنشاء العقد" });
    }
  };

  const clientId = form.watch("clientId");
  const selectedClient = clients.find((c) => c.id === clientId);

  return (
    <AppLayout>
      <div className="space-y-6 pb-10">

        {/* ── Breadcrumb & header ── */}
        <div className="flex items-center gap-4 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground -mr-1"
            onClick={() => setLocation("/contracts")}
          >
            <ArrowRight className="w-4 h-4" />
            العقود
          </Button>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-sm font-medium">عقد جديد</span>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">إنشاء عقد جديد</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              أدخل بيانات العقد كاملةً ثم احفظه لتوليد ملف PDF
            </p>
          </div>
        </div>

        {/* ── Two-column layout ── */}
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">

            {/* ── Main column ── */}
            <div className="space-y-5">

              {/* 1. البيانات الأساسية */}
              <SectionCard
                icon={<FileText className="w-4 h-4" />}
                title="البيانات الأساسية"
                subtitle="المعلومات الجوهرية للعقد"
              >
                {/* Client picker */}
                <Field
                  label="العميل"
                  required
                  error={form.formState.errors.clientId?.message}
                  full
                >
                  <Controller
                    control={form.control}
                    name="clientId"
                    render={({ field }) => (
                      <Popover open={clientOpen} onOpenChange={setClientOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            className="w-full justify-between font-normal text-right h-10"
                            dir="rtl"
                          >
                            <span className={selectedClient ? "font-medium" : "text-muted-foreground"}>
                              {selectedClient ? selectedClient.name : "ابحث عن عميل..."}
                            </span>
                            <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0 mr-2" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" dir="rtl" align="start">
                          <Command>
                            <CommandInput placeholder="ابحث بالاسم..." className="text-right" />
                            <CommandList>
                              <CommandEmpty>لا يوجد عميل بهذا الاسم</CommandEmpty>
                              {clients.map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={c.name}
                                  onSelect={() => handleClientSelect(c.id)}
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
                    )}
                  />
                </Field>

                <FieldRow>
                  <Field
                    label="نوع الخدمة"
                    required
                    error={form.formState.errors.serviceType?.message}
                  >
                    <Controller
                      control={form.control}
                      name="serviceType"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="w-full text-right h-10" dir="rtl">
                            <SelectValue placeholder="اختر نوع الخدمة" />
                          </SelectTrigger>
                          <SelectContent dir="rtl">
                            {Object.entries(SERVICE_TYPE_LABELS).map(([key, label]) => (
                              <SelectItem key={key} value={key}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>

                  <Field
                    label="حالة التوقيع"
                    error={undefined}
                  >
                    <Controller
                      control={form.control}
                      name="isSigned"
                      render={({ field }) => (
                        <Select
                          onValueChange={(v) => field.onChange(v === "true")}
                          value={String(field.value)}
                        >
                          <SelectTrigger className="w-full text-right h-10" dir="rtl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="false">غير موقع</SelectItem>
                            <SelectItem value="true">موقع</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </FieldRow>

                <FieldRow>
                  <Field
                    label="التاريخ الهجري"
                    required
                    error={form.formState.errors.hijriDate?.message}
                  >
                    <HijriDatePicker
                      value={form.watch("hijriDate")}
                      onChange={(v) => form.setValue("hijriDate", v, { shouldValidate: true })}
                      hasError={!!form.formState.errors.hijriDate}
                    />
                  </Field>
                  <Field label="التاريخ الميلادي">
                    <Input
                      {...form.register("gregorianDate")}
                      placeholder="2026/07/15"
                      dir="ltr"
                      className="text-left h-10"
                    />
                  </Field>
                </FieldRow>
              </SectionCard>

              {/* 2. بيانات الموكل التكميلية */}
              <SectionCard
                icon={<User className="w-4 h-4" />}
                title="بيانات الموكل التكميلية"
                subtitle="تُملأ تلقائياً من بيانات العميل المحفوظة"
              >
                <FieldRow>
                  <Field label="رقم الهوية / السجل التجاري">
                    <Input {...form.register("clientNationalId")} placeholder="10XXXXXXXX" dir="ltr" className="text-left h-10" />
                  </Field>
                  <Field label="عنوان الموكل">
                    <Input {...form.register("clientAddress")} placeholder="الرياض — حي النزهة" className="h-10" />
                  </Field>
                </FieldRow>
                <FieldRow>
                  <Field label="رقم الهاتف">
                    <Input {...form.register("clientPhone")} placeholder="05XXXXXXXX" dir="ltr" className="text-left h-10" />
                  </Field>
                  <Field label="البريد الإلكتروني">
                    <Input {...form.register("clientEmail")} placeholder="example@domain.com" dir="ltr" className="text-left h-10" type="email" />
                  </Field>
                </FieldRow>
              </SectionCard>

              {/* 3. بيانات القضية */}
              <SectionCard
                icon={<Gavel className="w-4 h-4" />}
                title="بيانات القضية"
                subtitle="اختياري — يُدرج في العقد إن أُدخل"
              >
                <FieldRow>
                  <Field label="رقم القضية">
                    <Input {...form.register("caseNumber")} placeholder="4772935070" dir="ltr" className="text-left h-10" />
                  </Field>
                  <Field label="المحكمة الناظرة">
                    <Input {...form.register("courtName")} placeholder="المحكمة العامة بالرياض" className="h-10" />
                  </Field>
                </FieldRow>
                <Field label="موضوع القضية" full>
                  <Input {...form.register("caseSubject")} placeholder="إخلاء عقار، إثبات حق، طلاق..." className="h-10" />
                </Field>
                <Field label="نطاق التوكيل" full>
                  <Input {...form.register("representationScope")} placeholder="حتى صدور حكم نهائي فيها" className="h-10" />
                </Field>
                <Field label="ديباجة العقد" full>
                  <Textarea {...form.register("preamble")} placeholder="نص الديباجة التمهيدية (اختياري)" rows={3} className="text-sm" />
                </Field>
              </SectionCard>

              {/* 4. الأتعاب */}
              <SectionCard
                icon={<Banknote className="w-4 h-4" />}
                title="الأتعاب"
                subtitle="حدد المبلغ الإجمالي أو أدخل جدول الأقساط"
              >
                <Field label="إجمالي الأتعاب (ريال سعودي)" full>
                  <Input
                    {...form.register("fees")}
                    type="number"
                    placeholder="يحتسب تلقائياً من الأقساط — أو أدخله يدوياً"
                    dir="ltr"
                    className="text-left h-10"
                  />
                </Field>
                <FeeInstallmentsEditor form={form} />
              </SectionCard>

              {/* 5. البنود الإضافية */}
              <SectionCard
                icon={<ListPlus className="w-4 h-4" />}
                title="البنود الإضافية"
                subtitle="بنود تُضاف للعقد بعد البنود القياسية"
              >
                <CustomClausesEditor form={form} />
              </SectionCard>
            </div>

            {/* ── Sidebar ── */}
            <div className="hidden lg:block">
              <SummarySidebar form={form} clients={clients} />
            </div>
          </div>

          {/* ── Sticky action bar ── */}
          <div className="sticky bottom-0 mt-6 -mx-4 px-4 py-4 bg-background/95 backdrop-blur border-t flex items-center justify-between gap-4 sm:-mx-6 sm:px-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span>تحقق من البيانات قبل الحفظ</span>
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/contracts")}
                disabled={createContract.isPending}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={createContract.isPending} className="gap-2 px-6">
                {createContract.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />جارٍ الحفظ…</>
                ) : (
                  <><FileText className="w-4 h-4" />حفظ العقد</>
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
