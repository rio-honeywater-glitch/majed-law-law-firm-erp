import { useState } from "react";
import { useLocation } from "wouter";
import {
  useCreateCase,
  useListClients,
  getListCasesQueryKey,
  getListClientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Loader2, UserPlus, Users, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import {
  JurisdictionSelectItems,
  opponentRoleLabel,
} from "@/pages/cases";
import {
  HijriDatePicker,
  gregorianStringToHijriValue,
  hijriValueToGregorianString,
} from "@/components/ui/hijri-date-picker";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const caseSchema = z.object({
  clientId: z.number().optional(),
  caseNumber: z.string().optional(),
  subject: z.string().min(3, "موضوع القضية مطلوب"),
  clientRole: z.enum(["PLAINTIFF", "DEFENDANT"], { required_error: "الرجاء تحديد صفة العميل" }),
  opponentName: z.string().min(1, "اسم الطرف الثاني مطلوب"),
  jurisdiction: z.string().min(1, "الرجاء اختيار جهة الاختصاص"),
  status: z.enum(["UNDER_REVIEW", "APPEAL", "EXECUTION", "CLOSED"]).default("UNDER_REVIEW"),
});
type CaseFormValues = z.infer<typeof caseSchema>;

const newClientSchema = z.object({
  name: z.string().min(1, "اسم العميل مطلوب"),
  phone: z
    .string()
    .optional()
    .refine((v) => !v || /^05\d{8}$/.test(v), "رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام"),
  email: z.string().email("بريد إلكتروني غير صالح").optional().or(z.literal("")),
  nationalId: z.string().optional(),
  agencyNumber: z.string().optional().or(z.literal("")),
  agencyEndDate: z.string().optional().or(z.literal("")),
  agencySource: z.enum(["خدمات الموثقين", "الخدمات الالكترونية"]).optional().or(z.literal("")),
});
type NewClientFormValues = z.infer<typeof newClientSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CaseNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [clientOpen, setClientOpen] = useState(false);

  const { data: clients } = useListClients({});
  const createCase = useCreateCase();

  const form = useForm<CaseFormValues>({
    resolver: zodResolver(caseSchema),
    defaultValues: {
      clientId: undefined,
      caseNumber: "",
      subject: "",
      clientRole: undefined,
      opponentName: "",
      jurisdiction: "",
      status: "UNDER_REVIEW",
    },
  });

  const newClientForm = useForm<NewClientFormValues>({
    resolver: zodResolver(newClientSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      nationalId: "",
      agencyNumber: "",
      agencyEndDate: "",
      agencySource: "",
    },
  });

  const onSubmit = async (data: CaseFormValues) => {
    try {
      let finalClientId = data.clientId;
      let caseData: typeof data & {
        newClient?: {
          name: string;
          phone?: string;
          email?: string;
          nationalId?: string;
          agencyNumber?: string;
          agencyEndDate?: string;
          agencySource?: "خدمات الموثقين" | "الخدمات الالكترونية";
        };
      } = data;

      if (clientMode === "existing") {
        if (!finalClientId) {
          form.setError("clientId", { message: "الرجاء اختيار العميل" });
          return;
        }
      } else {
        const isValid = await newClientForm.trigger();
        if (!isValid) return;

        const ncData = newClientForm.getValues();
        const { clientId: _clientId, ...caseFields } = data;
        caseData = {
          ...caseFields,
          newClient: {
            name: ncData.name,
            ...(ncData.phone ? { phone: ncData.phone } : {}),
            ...(ncData.email ? { email: ncData.email } : {}),
            ...(ncData.nationalId ? { nationalId: ncData.nationalId } : {}),
            ...(ncData.agencyNumber ? { agencyNumber: ncData.agencyNumber } : {}),
            ...(ncData.agencyEndDate ? { agencyEndDate: ncData.agencyEndDate } : {}),
            ...(ncData.agencySource ? { agencySource: ncData.agencySource } : {}),
          },
        };
      }

      const created = await createCase.mutateAsync({
        data: clientMode === "existing" ? { ...caseData, clientId: finalClientId! } : caseData,
      });
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
      toast({ title: "✅ تم إنشاء القضية بنجاح" });
      navigate(`/cases/${created.id}`);
    } catch (error) {
      const serverMessage =
        typeof (error as { data?: { error?: unknown } })?.data?.error === "string"
          ? (error as { data: { error: string } }).data.error
          : null;
      toast({
        variant: "destructive",
        title: serverMessage ?? "تعذر حفظ القضية. لم يتم حفظ أي بيانات، يرجى المحاولة مرة أخرى.",
      });
    }
  };

  const isPending = createCase.isPending;

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6 pb-24" dir="rtl">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/cases")}
            className="shrink-0"
          >
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">قضية جديدة</h2>
            <p className="text-muted-foreground text-sm mt-0.5">أدخل بيانات القضية ثم اضغط حفظ</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

          {/* ── العميل ───────────────────────────────────────────── */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-base">بيانات العميل</h3>

            {/* Mode toggle */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={clientMode === "existing" ? "default" : "outline"}
                className="flex-1 gap-2"
                onClick={() => setClientMode("existing")}
              >
                <Users className="w-4 h-4" />
                عميل موجود
              </Button>
              <Button
                type="button"
                variant={clientMode === "new" ? "default" : "outline"}
                className="flex-1 gap-2"
                onClick={() => {
                  setClientMode("new");
                  form.setValue("clientId", undefined as unknown as number);
                }}
              >
                <UserPlus className="w-4 h-4" />
                عميل جديد
              </Button>
            </div>

            {clientMode === "existing" ? (
              <div className="space-y-1.5">
                <Label>
                  العميل <span className="text-destructive">*</span>
                </Label>
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
                            className="w-full justify-between font-normal text-right h-10"
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
                                  onSelect={() => { field.onChange(c.id); setClientOpen(false); }}
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
                {form.formState.errors.clientId && (
                  <p className="text-xs text-destructive">{form.formState.errors.clientId.message}</p>
                )}
              </div>
            ) : (
              /* Inline new client fields */
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nc-name">
                    اسم العميل <span className="text-destructive">*</span>
                  </Label>
                  <Input id="nc-name" placeholder="الاسم الكامل" {...newClientForm.register("name")} />
                  {newClientForm.formState.errors.name && (
                    <p className="text-xs text-destructive">{newClientForm.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-phone">رقم الجوال</Label>
                    <Input id="nc-phone" dir="ltr" placeholder="05xxxxxxxx" maxLength={10} {...newClientForm.register("phone")} />
                    {newClientForm.formState.errors.phone && (
                      <p className="text-xs text-destructive">{newClientForm.formState.errors.phone.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-national">رقم الهوية</Label>
                    <Input id="nc-national" dir="ltr" placeholder="1xxxxxxxxx" {...newClientForm.register("nationalId")} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nc-email">البريد الإلكتروني</Label>
                  <Input id="nc-email" type="email" dir="ltr" placeholder="client@example.com" {...newClientForm.register("email")} />
                  {newClientForm.formState.errors.email && (
                    <p className="text-xs text-destructive">{newClientForm.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="border-t pt-4 space-y-4">
                  <p className="font-medium">
                    بيانات الوكالة <span className="text-muted-foreground text-xs font-normal">(اختياري)</span>
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-agency-number">رقم الوكالة</Label>
                    <Input
                      id="nc-agency-number"
                      placeholder="رقم الوكالة"
                      {...newClientForm.register("agencyNumber")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-agency-source">مصدر الوكالة</Label>
                    <Controller
                      control={newClientForm.control}
                      name="agencySource"
                      render={({ field }) => (
                        <Select
                          value={field.value || "NONE"}
                          onValueChange={(value) => field.onChange(value === "NONE" ? "" : value)}
                        >
                          <SelectTrigger id="nc-agency-source" className="w-full text-right" dir="rtl">
                            <SelectValue placeholder="اختر مصدر الوكالة" />
                          </SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="NONE">بدون مصدر</SelectItem>
                            <SelectItem value="خدمات الموثقين">خدمات الموثقين</SelectItem>
                            <SelectItem value="الخدمات الالكترونية">الخدمات الالكترونية</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-agency-end-date">تاريخ انتهاء الوكالة (هجري)</Label>
                    <Controller
                      control={newClientForm.control}
                      name="agencyEndDate"
                      render={({ field }) => (
                        <HijriDatePicker
                          value={gregorianStringToHijriValue(field.value)}
                          onChange={(value) => field.onChange(hijriValueToGregorianString(value))}
                          placeholder="اختر تاريخ الانتهاء"
                        />
                      )}
                    />
                    {newClientForm.watch("agencyEndDate") && (
                      <p className="text-xs text-muted-foreground">
                        الموافق ميلاديًا: {newClientForm.watch("agencyEndDate")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── بيانات القضية ────────────────────────────────────── */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-base">بيانات القضية</h3>

            {/* رقم القضية */}
            <div className="space-y-1.5">
              <Label>
                رقم القضية في المحكمة{" "}
                <span className="text-muted-foreground text-xs">(اختياري)</span>
              </Label>
              <Input {...form.register("caseNumber")} placeholder="مثال: 1234/1446" dir="ltr" />
            </div>

            {/* الموضوع */}
            <div className="space-y-1.5">
              <Label>
                موضوع القضية <span className="text-destructive">*</span>
              </Label>
              <Input {...form.register("subject")} placeholder="وصف موجز لموضوع القضية" />
              {form.formState.errors.subject && (
                <p className="text-xs text-destructive">{form.formState.errors.subject.message}</p>
              )}
            </div>

            {/* صفة العميل */}
            <div className="space-y-1.5">
              <Label>
                صفة العميل في القضية <span className="text-destructive">*</span>
              </Label>
              <Controller
                control={form.control}
                name="clientRole"
                render={({ field }) => (
                  <Select onValueChange={(val) => field.onChange(val as CaseFormValues["clientRole"])} value={field.value ?? ""}>
                    <SelectTrigger className="w-full text-right" dir="rtl">
                      <SelectValue placeholder="اختر صفة العميل" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="PLAINTIFF">مدعي</SelectItem>
                      <SelectItem value="DEFENDANT">مدعى عليه</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.clientRole && (
                <p className="text-xs text-destructive">{form.formState.errors.clientRole.message}</p>
              )}
            </div>

            {/* اسم الطرف الثاني */}
            <div className="space-y-1.5">
              <Label>
                اسم الطرف الثاني <span className="text-destructive">*</span>
                {opponentRoleLabel(form.watch("clientRole")) && (
                  <span className="text-muted-foreground text-xs mr-2">
                    (صفته: {opponentRoleLabel(form.watch("clientRole"))})
                  </span>
                )}
              </Label>
              <Input {...form.register("opponentName")} placeholder="اسم الطرف الثاني في القضية" />
              {form.formState.errors.opponentName && (
                <p className="text-xs text-destructive">{form.formState.errors.opponentName.message}</p>
              )}
            </div>

            {/* جهة الاختصاص */}
            <div className="space-y-1.5">
              <Label>
                جهة الاختصاص <span className="text-destructive">*</span>
              </Label>
              <Controller
                control={form.control}
                name="jurisdiction"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <SelectTrigger className="w-full text-right" dir="rtl">
                      <SelectValue placeholder="اختر جهة الاختصاص" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <JurisdictionSelectItems />
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.jurisdiction && (
                <p className="text-xs text-destructive">{form.formState.errors.jurisdiction.message}</p>
              )}
            </div>
          </div>

          {/* ── زر الحفظ الثابت في الأسفل ────────────────────────── */}
          <div className="fixed bottom-0 right-0 left-0 z-10 bg-background/95 backdrop-blur border-t px-4 py-3 flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/cases")}
              disabled={isPending}
            >
              إلغاء
            </Button>
            <Button type="submit" disabled={isPending} className="min-w-[120px]">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
              حفظ القضية
            </Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
