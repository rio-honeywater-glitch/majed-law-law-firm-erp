import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetClient,
  useUpdateClient,
  getGetClientQueryKey,
  getListClientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ArrowRight, User, Phone, Mail, FileText, Briefcase, Calendar, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { useSortable, SortableHead, IndexHead } from "@/components/ui/sortable-table";
import {
  HijriDatePicker,
  gregorianStringToHijriValue,
  hijriValueToGregorianString,
} from "@/components/ui/hijri-date-picker";

const agencyFormSchema = z.object({
  agencyNumber: z.string().optional().or(z.literal("")),
  agencyEndDate: z.string().optional().or(z.literal("")),
  agencySource: z.enum(["خدمات الموثقين", "الخدمات الالكترونية"]).optional().or(z.literal("")),
});

type AgencyFormValues = z.infer<typeof agencyFormSchema>;

export default function ClientDetail() {
  const params = useParams();
  const clientId = Number(params.id);
  const { isManager } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAgencyDialogOpen, setIsAgencyDialogOpen] = useState(false);
  const updateClient = useUpdateClient();

  const { data: client, isLoading } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId) }
  });

  const agencyForm = useForm<AgencyFormValues>({
    resolver: zodResolver(agencyFormSchema),
    defaultValues: {
      agencyNumber: "",
      agencyEndDate: "",
      agencySource: "",
    },
  });

  const openAgencyEdit = () => {
    if (!client) return;
    agencyForm.reset({
      agencyNumber: client.agencyNumber ?? "",
      agencyEndDate: client.agencyEndDate ?? "",
      agencySource: client.agencySource ?? "",
    });
    setIsAgencyDialogOpen(true);
  };

  const onAgencySubmit = async (data: AgencyFormValues) => {
    try {
      await updateClient.mutateAsync({
        id: clientId,
        data: {
          agencyNumber: data.agencyNumber || null,
          agencyEndDate: data.agencyEndDate || null,
          agencySource: data.agencySource || null,
        },
      });
      setIsAgencyDialogOpen(false);
      agencyForm.reset(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) }),
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }),
      ]);
      toast({ title: "✅ تم تحديث بيانات الوكالة" });
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث بيانات الوكالة" });
    }
  };

  const casesSort = useSortable(client?.cases ?? undefined, {
    caseNumber: (c) => c.caseNumber || `قضية #${c.id}`,
    subject: (c) => c.subject,
    opponentName: (c) => c.opponentName,
    status: (c) => c.status,
  });
  const contractsSort = useSortable(client?.contracts ?? undefined, {
    serviceType: (c) => c.serviceType,
    hijriDate: (c) => c.hijriDate,
    isSigned: (c) => c.isSigned,
    fees: (c) => c.fees,
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!client) return <AppLayout><div className="p-8 text-center text-muted-foreground">العميل غير موجود</div></AppLayout>;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const agencyExpired = !!client.agencyEndDate && client.agencyEndDate < today;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/clients" className="p-2 hover:bg-muted rounded-full transition-colors">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{client.name}</h2>
            <p className="text-muted-foreground mt-1">تفاصيل ملف العميل</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-1 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="w-5 h-5 text-primary" />
                المعلومات الأساسية
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-sm text-muted-foreground block mb-1">الهوية / السجل التجاري</span>
                <p className="font-medium">{client.nationalId || "-"}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground block mb-1">رقم الهاتف</span>
                <p className="font-medium flex items-center gap-2" dir="ltr">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  {client.phone || "-"}
                </p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground block mb-1">البريد الإلكتروني</span>
                <p className="font-medium flex items-center gap-2" dir="ltr">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  {client.email || "-"}
                </p>
              </div>
              {client.notes && (
                <div>
                  <span className="text-sm text-muted-foreground block mb-1">ملاحظات</span>
                  <p className="text-sm bg-muted/50 p-3 rounded-md">{client.notes}</p>
                </div>
              )}
              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">بيانات الوكالة</span>
                    <button
                      type="button"
                      onClick={openAgencyEdit}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                      title="تعديل بيانات الوكالة"
                      aria-label="تعديل بيانات الوكالة"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  {client.agencyEndDate && (
                    <Badge
                      variant={agencyExpired ? "destructive" : "outline"}
                      className={!agencyExpired ? "text-emerald-600 border-emerald-600" : ""}
                    >
                      {agencyExpired ? "منتهية" : "سارية"}
                    </Badge>
                  )}
                </div>
                <div>
                  <span className="text-sm text-muted-foreground block mb-1">رقم الوكالة</span>
                  <p className="font-medium">{client.agencyNumber || "-"}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground block mb-1">مصدر الوكالة</span>
                  <p className="font-medium">{client.agencySource || "-"}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground block mb-1">تاريخ انتهاء الوكالة</span>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {client.agencyEndDate
                      ? `${gregorianStringToHijriValue(client.agencyEndDate)} هـ — ${client.agencyEndDate} م`
                      : "-"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="md:col-span-2 space-y-6">
            {/* Cases Table */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Briefcase className="w-5 h-5 text-primary" />
                  القضايا ({client.cases?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <IndexHead />
                        <SortableHead label="رقم القضية" sortKey="caseNumber" currentKey={casesSort.sortKey} dir={casesSort.sortDir} onToggle={casesSort.toggle} />
                        <SortableHead label="الموضوع" sortKey="subject" currentKey={casesSort.sortKey} dir={casesSort.sortDir} onToggle={casesSort.toggle} />
                        <SortableHead label="الخصم" sortKey="opponentName" currentKey={casesSort.sortKey} dir={casesSort.sortDir} onToggle={casesSort.toggle} />
                        <SortableHead label="الحالة" sortKey="status" currentKey={casesSort.sortKey} dir={casesSort.sortDir} onToggle={casesSort.toggle} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {casesSort.sorted && casesSort.sorted.length > 0 ? (
                        casesSort.sorted.map((c, idx) => (
                          <TableRow key={c.id}>
                            <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                            <TableCell>
                              <Link href={`/cases/${c.id}`} className="text-primary hover:underline font-medium">
                                {c.caseNumber || "قضية #" + c.id}
                              </Link>
                            </TableCell>
                            <TableCell>{c.subject || "-"}</TableCell>
                            <TableCell>{c.opponentName || "-"}</TableCell>
                            <TableCell>
                              <Badge variant={c.status === "CLOSED" ? "outline" : c.status === "EXECUTION" ? "destructive" : "default"}>
                                {c.status === "CLOSED" ? "منتهية" : c.status === "EXECUTION" ? "تنفيذ" : "تحت النظر"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">لا توجد قضايا مسجلة</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Contracts Table */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-primary" />
                  العقود ({client.contracts?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <IndexHead />
                        <SortableHead label="نوع الخدمة" sortKey="serviceType" currentKey={contractsSort.sortKey} dir={contractsSort.sortDir} onToggle={contractsSort.toggle} />
                        <SortableHead label="التاريخ الهجري" sortKey="hijriDate" currentKey={contractsSort.sortKey} dir={contractsSort.sortDir} onToggle={contractsSort.toggle} />
                        <SortableHead label="حالة التوقيع" sortKey="isSigned" currentKey={contractsSort.sortKey} dir={contractsSort.sortDir} onToggle={contractsSort.toggle} />
                        {isManager && <SortableHead label="الأتعاب" sortKey="fees" currentKey={contractsSort.sortKey} dir={contractsSort.sortDir} onToggle={contractsSort.toggle} className="text-left" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contractsSort.sorted && contractsSort.sorted.length > 0 ? (
                        contractsSort.sorted.map((contract, idx) => (
                          <TableRow key={contract.id}>
                            <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                            <TableCell className="font-medium">{contract.serviceType}</TableCell>
                            <TableCell>{contract.hijriDate}</TableCell>
                            <TableCell>
                              {contract.isSigned ? (
                                <Badge className="bg-emerald-500 hover:bg-emerald-600">موقع</Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-600">غير موقع</Badge>
                              )}
                            </TableCell>
                            {isManager && (
                              <TableCell className="text-left font-mono">
                                {contract.fees ? `${contract.fees.toLocaleString()} ﷼` : "-"}
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={isManager ? 5 : 4} className="text-center py-6 text-muted-foreground">لا توجد عقود مسجلة</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={isAgencyDialogOpen} onOpenChange={setIsAgencyDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل بيانات الوكالة</DialogTitle>
          </DialogHeader>
          <form onSubmit={agencyForm.handleSubmit(onAgencySubmit)} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="agency-number">رقم الوكالة</Label>
              <Input
                id="agency-number"
                placeholder="رقم الوكالة"
                {...agencyForm.register("agencyNumber")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agency-source">مصدر الوكالة</Label>
              <Controller
                control={agencyForm.control}
                name="agencySource"
                render={({ field }) => (
                  <Select
                    value={field.value || "NONE"}
                    onValueChange={(value) => field.onChange(value === "NONE" ? "" : value)}
                  >
                    <SelectTrigger id="agency-source" className="w-full text-right" dir="rtl">
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
            <div className="space-y-2">
              <Label htmlFor="agency-end-date">تاريخ انتهاء الوكالة (هجري)</Label>
              <Controller
                control={agencyForm.control}
                name="agencyEndDate"
                render={({ field }) => (
                  <HijriDatePicker
                    value={gregorianStringToHijriValue(field.value)}
                    onChange={(value) => field.onChange(hijriValueToGregorianString(value))}
                    placeholder="اختر تاريخ الانتهاء"
                  />
                )}
              />
              {agencyForm.watch("agencyEndDate") && (
                <p className="text-xs text-muted-foreground">
                  الموافق ميلاديًا: {agencyForm.watch("agencyEndDate")}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAgencyDialogOpen(false)}
              >
                إلغاء
              </Button>
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