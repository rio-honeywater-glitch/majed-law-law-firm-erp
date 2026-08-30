import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useListClients, useCreateClient, useUpdateClient,
  useListCases, getListClientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, Plus, Loader2, Users, Pencil, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSortable, SortableHead, IndexHead } from "@/components/ui/sortable-table";
import { DateRangeFilter, filterByDateRange, type DateRangeValue } from "@/components/ui/date-range-filter";
import { JURISDICTION_GROUPS, JURISDICTION_FLAT } from "./cases";
import {
  HijriDatePicker,
  gregorianStringToHijriValue,
  hijriValueToGregorianString,
} from "@/components/ui/hijri-date-picker";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const clientSchema = z.object({
  name: z.string().min(2, "الاسم مطلوب"),
  email: z.string().email("بريد إلكتروني غير صالح").min(1, "البريد الإلكتروني مطلوب"),
  phone: z.string().min(1, "رقم الهاتف مطلوب"),
  nationalId: z
    .string()
    .regex(/^\d*$/, "يجب أن يحتوي على أرقام فقط")
    .max(10, "السجل التجاري يجب ألا يتجاوز 10 أرقام")
    .optional()
    .or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  agencyNumber: z.string().optional().or(z.literal("")),
  agencyEndDate: z.string().optional().or(z.literal("")),
  agencySource: z.enum(["خدمات الموثقين", "الخدمات الالكترونية"]).optional().or(z.literal("")),
});

const editClientSchema = z.object({
  name: z.string().min(2, "الاسم مطلوب"),
  phone: z.string().min(1, "رقم الهاتف مطلوب"),
  email: z.string().email("بريد إلكتروني غير صالح").or(z.literal("")),
  nationalId: z
    .string()
    .regex(/^\d*$/, "يجب أن يحتوي على أرقام فقط")
    .max(10, "السجل التجاري يجب ألا يتجاوز 10 أرقام")
    .optional()
    .or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  agencyNumber: z.string().optional().or(z.literal("")),
  agencyEndDate: z.string().optional().or(z.literal("")),
  agencySource: z.enum(["خدمات الموثقين", "الخدمات الالكترونية"]).optional().or(z.literal("")),
});

type ClientFormValues = z.infer<typeof clientSchema>;
type EditClientFormValues = z.infer<typeof editClientSchema>;

// ─── Status labels ────────────────────────────────────────────────────────────

const CASE_STATUS_LABELS: Record<string, string> = {
  UNDER_REVIEW: "تحت النظر",
  APPEAL: "الاستئناف",
  EXECUTION: "تنفيذ",
  CLOSED: "منتهية",
};

const ALL_JURISDICTIONS = [
  ...JURISDICTION_GROUPS.flatMap((g) => g.options),
  ...JURISDICTION_FLAT,
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Clients() {
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateRangeValue>({ preset: "all" });
  const [clientRoleFilter, setClientRoleFilter] = useState("ALL");
  const [caseStatusFilter, setCaseStatusFilter] = useState("ALL");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("ALL");
  const [editingClient, setEditingClient] = useState<{
    id: number; name: string; phone?: string | null; email?: string | null;
    nationalId?: string | null; address?: string | null;
    agencyNumber?: string | null; agencyEndDate?: string | null; agencySource?: string | null;
  } | null>(null);

  const { data: clients, isLoading } = useListClients(search ? { search } : {});
  const { data: allCases } = useListCases({});
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Compute per-client case aggregations ──────────────────────────────────
  const clientCaseMap = useMemo(() => {
    const map = new Map<number, { count: number; roles: Set<string>; statuses: Set<string>; jurisdictions: Set<string> }>();
    (allCases ?? []).forEach((c) => {
      if (!map.has(c.clientId)) map.set(c.clientId, { count: 0, roles: new Set(), statuses: new Set(), jurisdictions: new Set() });
      const entry = map.get(c.clientId)!;
      entry.count++;
      if (c.clientRole) entry.roles.add(c.clientRole);
      if (c.status) entry.statuses.add(c.status);
      if (c.jurisdiction) entry.jurisdictions.add(c.jurisdiction);
    });
    return map;
  }, [allCases]);

  // ── Apply all filters ─────────────────────────────────────────────────────
  const filteredByDate = filterByDateRange(clients, dateFilter);
  const filteredClients = useMemo(() => {
    if (!filteredByDate) return filteredByDate;
    return filteredByDate.filter((c) => {
      const cdata = clientCaseMap.get(c.id);
      if (clientRoleFilter !== "ALL") {
        if (!cdata || !cdata.roles.has(clientRoleFilter)) return false;
      }
      if (caseStatusFilter !== "ALL") {
        if (!cdata || !cdata.statuses.has(caseStatusFilter)) return false;
      }
      if (jurisdictionFilter !== "ALL") {
        if (!cdata || !cdata.jurisdictions.has(jurisdictionFilter)) return false;
      }
      return true;
    });
  }, [filteredByDate, clientCaseMap, clientRoleFilter, caseStatusFilter, jurisdictionFilter]);

  const { sorted: sortedClients, sortKey, sortDir, toggle } = useSortable(filteredClients, {
    name: (c) => c.name,
    nationalId: (c) => c.nationalId,
    phone: (c) => c.phone,
    email: (c) => c.email,
    caseCount: (c) => clientCaseMap.get(c.id)?.count ?? 0,
  }, "clients-sort");

  // ── Create form ───────────────────────────────────────────────────────────
  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: "", email: "", phone: "", nationalId: "", address: "",
      agencyNumber: "", agencyEndDate: "", agencySource: "",
    },
  });

  const onSubmit = async (data: ClientFormValues) => {
    try {
      await createClient.mutateAsync({
        data: {
          ...data,
          agencyNumber: data.agencyNumber || undefined,
          agencyEndDate: data.agencyEndDate || undefined,
          agencySource: data.agencySource || undefined,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "تم إضافة العميل بنجاح" });
    } catch (e) {
      toast({ variant: "destructive", title: "حدث خطأ أثناء إضافة العميل" });
    }
  };

  // ── Edit form ─────────────────────────────────────────────────────────────
  const editForm = useForm<EditClientFormValues>({
    resolver: zodResolver(editClientSchema),
    defaultValues: {
      name: "", phone: "", email: "", nationalId: "", address: "",
      agencyNumber: "", agencyEndDate: "", agencySource: "",
    },
  });

  const openEdit = (c: typeof editingClient) => {
    setEditingClient(c);
    editForm.reset({
      name: c?.name ?? "",
      phone: c?.phone ?? "",
      email: c?.email ?? "",
      nationalId: c?.nationalId ?? "",
      address: c?.address ?? "",
      agencyNumber: c?.agencyNumber ?? "",
      agencyEndDate: c?.agencyEndDate ?? "",
      agencySource: (c?.agencySource as EditClientFormValues["agencySource"]) ?? "",
    });
  };

  const onEditSubmit = async (data: EditClientFormValues) => {
    if (!editingClient) return;
    try {
      await updateClient.mutateAsync({
        id: editingClient.id,
        data: {
          name: data.name,
          phone: data.phone || undefined,
          email: data.email || undefined,
          nationalId: data.nationalId || undefined,
          address: data.address || undefined,
          agencyNumber: data.agencyNumber || null,
          agencyEndDate: data.agencyEndDate || null,
          agencySource: data.agencySource || null,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      setEditingClient(null);
      toast({ title: "✅ تم تحديث بيانات العميل" });
    } catch (e) {
      toast({ variant: "destructive", title: "فشل تحديث بيانات العميل" });
    }
  };

  const activeFilters = [clientRoleFilter !== "ALL", caseStatusFilter !== "ALL", jurisdictionFilter !== "ALL"].filter(Boolean).length;

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">العملاء</h2>
            <p className="text-muted-foreground mt-1">إدارة بيانات العملاء والشركات</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                إضافة عميل جديد
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>إضافة عميل جديد</DialogTitle>
              </DialogHeader>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>الاسم <span className="text-destructive">*</span></Label>
                  <Input {...form.register("name")} placeholder="اسم العميل أو الشركة" />
                </div>
                <div className="space-y-2">
                  <Label>رقم الهوية / السجل التجاري <span className="text-muted-foreground text-xs font-normal">(اختياري)</span></Label>
                  <Input {...form.register("nationalId")} placeholder="أرقام فقط" inputMode="numeric" maxLength={10} />
                  {form.formState.errors.nationalId && <p className="text-sm text-destructive">{form.formState.errors.nationalId.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>رقم الهاتف <span className="text-destructive">*</span></Label>
                  <Input {...form.register("phone")} placeholder="05xxxxxxxx" dir="ltr" className="text-right" />
                  {form.formState.errors.phone && <p className="text-sm text-destructive">{form.formState.errors.phone.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>البريد الإلكتروني <span className="text-destructive">*</span></Label>
                  <Input {...form.register("email")} type="email" placeholder="example@domain.com" dir="ltr" className="text-right" />
                  {form.formState.errors.email && <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>العنوان <span className="text-muted-foreground text-xs font-normal">(اختياري)</span></Label>
                  <Input {...form.register("address")} placeholder="المدينة — الحي" />
                </div>
                <div className="border-t pt-4 space-y-4">
                  <p className="font-medium">بيانات الوكالة <span className="text-muted-foreground text-xs font-normal">(اختياري)</span></p>
                  <div className="space-y-2">
                    <Label>رقم الوكالة</Label>
                    <Input {...form.register("agencyNumber")} placeholder="رقم الوكالة" />
                  </div>
                  <div className="space-y-2">
                    <Label>مصدر الوكالة</Label>
                    <Controller
                      control={form.control}
                      name="agencySource"
                      render={({ field }) => (
                        <Select value={field.value || "NONE"} onValueChange={(value) => field.onChange(value === "NONE" ? "" : value)}>
                          <SelectTrigger><SelectValue placeholder="اختر مصدر الوكالة" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">بدون مصدر</SelectItem>
                            <SelectItem value="خدمات الموثقين">خدمات الموثقين</SelectItem>
                            <SelectItem value="الخدمات الالكترونية">الخدمات الالكترونية</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>تاريخ انتهاء الوكالة (هجري)</Label>
                    <Controller
                      control={form.control}
                      name="agencyEndDate"
                      render={({ field }) => (
                        <HijriDatePicker
                          value={gregorianStringToHijriValue(field.value)}
                          onChange={(value) => field.onChange(hijriValueToGregorianString(value))}
                          placeholder="اختر تاريخ الانتهاء"
                        />
                      )}
                    />
                    {form.watch("agencyEndDate") && (
                      <p className="text-xs text-muted-foreground">الموافق ميلاديًا: {form.watch("agencyEndDate")}</p>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                  <Button type="submit" disabled={createClient.isPending}>
                    {createClient.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <div className="space-y-3">
          {/* Search + dropdown filters row */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="البحث عن عميل..."
                className="pl-8 pr-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Client role filter */}
            <Select value={clientRoleFilter} onValueChange={setClientRoleFilter}>
              <SelectTrigger className="w-[160px] text-right" dir="rtl">
                <SelectValue placeholder="صفة العميل" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="ALL">جميع الصفات</SelectItem>
                <SelectItem value="PLAINTIFF">
                  <span className="flex items-center gap-2">مدعي <Badge className="bg-blue-500/20 text-blue-600 border-0 text-[10px] h-4">لنا</Badge></span>
                </SelectItem>
                <SelectItem value="DEFENDANT">
                  <span className="flex items-center gap-2">مدعى عليه <Badge className="bg-rose-500/20 text-rose-600 border-0 text-[10px] h-4">علينا</Badge></span>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Case status filter */}
            <Select value={caseStatusFilter} onValueChange={setCaseStatusFilter}>
              <SelectTrigger className="w-[160px] text-right" dir="rtl">
                <SelectValue placeholder="حالة القضية" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="ALL">جميع الحالات</SelectItem>
                <SelectItem value="UNDER_REVIEW">تحت النظر</SelectItem>
                <SelectItem value="APPEAL">الاستئناف</SelectItem>
                <SelectItem value="EXECUTION">تنفيذ</SelectItem>
                <SelectItem value="CLOSED">منتهية</SelectItem>
              </SelectContent>
            </Select>

            {/* Jurisdiction filter */}
            <Select value={jurisdictionFilter} onValueChange={setJurisdictionFilter}>
              <SelectTrigger className="w-[180px] text-right" dir="rtl">
                <SelectValue placeholder="الجهة المختصة" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="ALL">جميع الجهات</SelectItem>
                {ALL_JURISDICTIONS.map((j) => (
                  <SelectItem key={j} value={j}>{j}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {activeFilters > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-destructive h-9"
                onClick={() => { setClientRoleFilter("ALL"); setCaseStatusFilter("ALL"); setJurisdictionFilter("ALL"); }}
              >
                <X className="w-3.5 h-3.5" />
                مسح الفلاتر ({activeFilters})
              </Button>
            )}
          </div>

          {/* Date range filter row */}
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        </div>

        {/* Table */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <IndexHead />
                <SortableHead label="الاسم" sortKey="name" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الهوية" sortKey="nationalId" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الهاتف" sortKey="phone" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="البريد الإلكتروني" sortKey="email" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="عدد القضايا" sortKey="caseCount" currentKey={sortKey} dir={sortDir} onToggle={toggle} className="text-center" />
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : sortedClients?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    {activeFilters > 0 || dateFilter.preset !== "all" ? "لا يوجد عملاء مطابقون للفلاتر المحددة" : "لا يوجد عملاء"}
                  </TableCell>
                </TableRow>
              ) : (
                sortedClients?.map((client, idx) => {
                  const cdata = clientCaseMap.get(client.id);
                  return (
                    <TableRow key={client.id} className="group hover:bg-muted/30">
                      <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/clients/${client.id}`} className="hover:text-primary hover:underline">
                          {client.name}
                        </Link>
                      </TableCell>
                      <TableCell>{client.nationalId || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-right">{client.phone || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-right">{client.email || "-"}</TableCell>
                      <TableCell className="text-center">
                        {cdata && cdata.count > 0 ? (
                          <Badge variant="outline" className="font-mono font-bold text-primary border-primary/30">
                            {cdata.count}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); openEdit(client); }}
                          title="تعديل بيانات العميل"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingClient} onOpenChange={(o) => { if (!o) setEditingClient(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل بيانات العميل</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>الاسم <span className="text-destructive">*</span></Label>
              <Input {...editForm.register("name")} placeholder="اسم العميل أو الشركة" />
              {editForm.formState.errors.name && <p className="text-sm text-destructive">{editForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>رقم الهوية / السجل التجاري <span className="text-muted-foreground text-xs font-normal">(اختياري)</span></Label>
              <Input {...editForm.register("nationalId")} placeholder="أرقام فقط" inputMode="numeric" maxLength={10} />
              {editForm.formState.errors.nationalId && <p className="text-sm text-destructive">{editForm.formState.errors.nationalId.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>رقم الهاتف <span className="text-destructive">*</span></Label>
              <Input {...editForm.register("phone")} placeholder="05xxxxxxxx" dir="ltr" className="text-right" />
              {editForm.formState.errors.phone && <p className="text-sm text-destructive">{editForm.formState.errors.phone.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input {...editForm.register("email")} type="email" placeholder="example@domain.com" dir="ltr" className="text-right" />
              {editForm.formState.errors.email && <p className="text-sm text-destructive">{editForm.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>العنوان <span className="text-muted-foreground text-xs font-normal">(اختياري)</span></Label>
              <Input {...editForm.register("address")} placeholder="المدينة — الحي" />
            </div>
            <div className="border-t pt-4 space-y-4">
              <p className="font-medium">بيانات الوكالة <span className="text-muted-foreground text-xs font-normal">(اختياري)</span></p>
              <div className="space-y-2">
                <Label>رقم الوكالة</Label>
                <Input {...editForm.register("agencyNumber")} placeholder="رقم الوكالة" />
              </div>
              <div className="space-y-2">
                <Label>مصدر الوكالة</Label>
                <Controller
                  control={editForm.control}
                  name="agencySource"
                  render={({ field }) => (
                    <Select value={field.value || "NONE"} onValueChange={(value) => field.onChange(value === "NONE" ? "" : value)}>
                      <SelectTrigger><SelectValue placeholder="اختر مصدر الوكالة" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">بدون مصدر</SelectItem>
                        <SelectItem value="خدمات الموثقين">خدمات الموثقين</SelectItem>
                        <SelectItem value="الخدمات الالكترونية">الخدمات الالكترونية</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>تاريخ انتهاء الوكالة (هجري)</Label>
                <Controller
                  control={editForm.control}
                  name="agencyEndDate"
                  render={({ field }) => (
                    <HijriDatePicker
                      value={gregorianStringToHijriValue(field.value)}
                      onChange={(value) => field.onChange(hijriValueToGregorianString(value))}
                      placeholder="اختر تاريخ الانتهاء"
                    />
                  )}
                />
                {editForm.watch("agencyEndDate") && (
                  <p className="text-xs text-muted-foreground">الموافق ميلاديًا: {editForm.watch("agencyEndDate")}</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingClient(null)}>إلغاء</Button>
              <Button type="submit" disabled={updateClient.isPending}>
                {updateClient.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ التعديلات"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
