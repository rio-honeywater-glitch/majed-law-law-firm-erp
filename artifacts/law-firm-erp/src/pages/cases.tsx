import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useListCases, useDeleteCase, getListCasesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Briefcase, Loader2, Trash2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSortable, SortableHead, IndexHead } from "@/components/ui/sortable-table";
import { DateRangeFilter, filterByDateRange, type DateRangeValue } from "@/components/ui/date-range-filter";
import { useAuth } from "@/lib/auth";


export const JURISDICTION_GROUPS: { label: string; options: string[] }[] = [
  {
    label: "محاكم الدرجة الأولى",
    options: ["المحاكم العامة", "المحاكم الجزائية", "محاكم الأحوال الشخصية", "المحاكم التجارية", "المحاكم العمالية"],
  },
];
export const JURISDICTION_FLAT: string[] = ["محاكم التنفيذ", "محاكم الاستئناف", "المحكمة العليا"];

export function JurisdictionSelectItems() {
  return (
    <>
      {JURISDICTION_GROUPS.map((g) => (
        <SelectGroup key={g.label}>
          <SelectLabel className="text-primary font-bold">{g.label}</SelectLabel>
          {g.options.map((o) => (
            <SelectItem key={o} value={o} className="pr-6 text-muted-foreground data-[highlighted]:text-foreground">
              {o}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
      {JURISDICTION_FLAT.map((o) => (
        <SelectItem key={o} value={o} className="text-primary font-bold data-[highlighted]:text-primary">
          {o}
        </SelectItem>
      ))}
    </>
  );
}

export const CLIENT_ROLE_LABELS: Record<string, string> = {
  PLAINTIFF: "مدعي",
  DEFENDANT: "مدعى عليه",
};

export function opponentRoleLabel(clientRole?: string | null): string | null {
  if (clientRole === "PLAINTIFF") return "مدعى عليه";
  if (clientRole === "DEFENDANT") return "مدعي";
  return null;
}


export default function Cases() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showDeleted, setShowDeleted] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateRangeValue>({ preset: "all" });
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; label: string } | null>(null);
  const [, navigate] = useLocation();
  const { isManager } = useAuth();

  const searchString = useSearch();
  const outcomeParam = new URLSearchParams(searchString).get("outcome");
  const outcomeFilter = outcomeParam === "WON" || outcomeParam === "LOST" || outcomeParam === "PENDING" ? outcomeParam : "ALL";
  const setOutcomeFilter = (value: string) => {
    navigate(value === "ALL" ? "/cases" : `/cases?outcome=${value}`, { replace: true });
  };

  const { data: cases, isLoading } = useListCases({
    search: search || undefined,
    status: statusFilter !== "ALL" ? statusFilter : undefined,
    outcome: outcomeFilter !== "ALL" ? (outcomeFilter as "WON" | "LOST" | "PENDING") : undefined,
  });

  const visibleCases = showDeleted ? cases : cases?.filter((c) => !c.deletedAt);
  const casesForSort = filterByDateRange(visibleCases, dateFilter);
  const { sorted: sortedCases, sortKey, sortDir, toggle } = useSortable(casesForSort, {
    caseNumber: (c) => c.caseNumber || `ملف #${c.id}`,
    clientName: (c) => c.clientName,
    clientRole: (c) => c.clientRole,
    subject: (c) => c.subject,
    opponentName: (c) => c.opponentName,
    opponentRole: (c) => opponentRoleLabel(c.clientRole),
    jurisdiction: (c) => c.jurisdiction,
    status: (c) => c.status,
  }, "cases-table-sort");

  const deleteCase = useDeleteCase();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteCase.mutateAsync({ id: confirmDelete.id });
      queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
      toast({ title: `تم حذف القضية "${confirmDelete.label}"` });
      setConfirmDelete(null);
    } catch {
      toast({ variant: "destructive", title: "فشل حذف القضية" });
      setConfirmDelete(null);
    }
  };

  const getOutcomeBadge = (outcome: string) => {
    switch (outcome) {
      case "WON": return <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 border-0">ناجحة</Badge>;
      case "LOST": return <Badge className="bg-red-500/20 text-red-600 dark:text-red-400 border-0">خاسرة</Badge>;
      default: return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "UNDER_REVIEW": return <Badge className="bg-primary/20 text-primary border-0">تحت النظر</Badge>;
      case "APPEAL": return <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 border-0">الاستئناف</Badge>;
      case "EXECUTION": return <Badge className="bg-destructive/20 text-destructive border-0">تنفيذ</Badge>;
      case "CLOSED": return <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">منتهية</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const deletedCount = cases?.filter((c) => c.deletedAt).length ?? 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">القضايا</h2>
            <p className="text-muted-foreground mt-1">سجل القضايا والمنازعات</p>
          </div>

          <Link href="/cases/new">
            <Button className="gap-2 shadow-sm">
              <Plus className="w-4 h-4" />
              إنشاء قضية جديدة
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full max-w-sm">
              <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="البحث في القضايا..."
                className="pl-8 pr-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[160px] text-right" dir="rtl">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="ALL">جميع الحالات</SelectItem>
                  <SelectItem value="UNDER_REVIEW">تحت النظر</SelectItem>
                  <SelectItem value="APPEAL">الاستئناف</SelectItem>
                  <SelectItem value="EXECUTION">تنفيذ</SelectItem>
                  <SelectItem value="CLOSED">منتهية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-auto">
              <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
                <SelectTrigger className="w-full sm:w-[160px] text-right" dir="rtl">
                  <SelectValue placeholder="النتيجة" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="ALL">جميع النتائج</SelectItem>
                  <SelectItem value="WON">الناجحة</SelectItem>
                  <SelectItem value="LOST">الخاسرة</SelectItem>
                  <SelectItem value="PENDING">قيد النظر</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Toggle show/hide deleted — manager only */}
            {isManager && deletedCount > 0 && (
              <Button
                size="sm"
                variant={showDeleted ? "secondary" : "outline"}
                onClick={() => setShowDeleted((v) => !v)}
                className="gap-2 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {showDeleted ? `إخفاء المحذوفة (${deletedCount})` : `إظهار المحذوفة (${deletedCount})`}
              </Button>
            )}
          </div>
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        </div>

        {/* Table */}
        <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <IndexHead />
                <SortableHead label="رقم القضية" sortKey="caseNumber" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="العميل" sortKey="clientName" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="حالة العميل" sortKey="clientRole" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الموضوع" sortKey="subject" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الطرف الثاني" sortKey="opponentName" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="حالة الطرف الثاني" sortKey="opponentRole" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="المحكمة" sortKey="jurisdiction" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="الحالة" sortKey="status" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                {isManager && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isManager ? 10 : 9} className="text-center h-24">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : sortedCases?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isManager ? 10 : 9} className="text-center h-32 text-muted-foreground">
                    <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    لا توجد قضايا مطابقة للبحث
                  </TableCell>
                </TableRow>
              ) : (
                sortedCases?.map((c, idx) => {
                  const isDeleted = !!c.deletedAt;
                  return (
                    <TableRow
                      key={c.id}
                      className={`group cursor-pointer transition-colors ${
                        isDeleted
                          ? "bg-muted/60 hover:bg-muted/80 opacity-70"
                          : "hover:bg-muted/30"
                      }`}
                      onClick={() => navigate(`/cases/${c.id}`)}
                    >
                      <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`${isDeleted ? "line-through text-muted-foreground" : "text-primary group-hover:underline"}`}>
                            {c.caseNumber || `ملف #${c.id}`}
                          </span>
                          {isDeleted && (
                            <Badge className="bg-destructive/15 text-destructive border border-destructive/30 text-[10px] px-1.5 py-0 gap-1">
                              <Trash2 className="w-2.5 h-2.5" />
                              محذوفة
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/clients/${c.clientId}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.clientName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {c.clientRole ? (
                          <Badge className="bg-blue-500/20 text-blue-600 dark:text-blue-400 border-0">
                            {CLIENT_ROLE_LABELS[c.clientRole]}
                          </Badge>
                        ) : "-"}
                      </TableCell>
                      <TableCell className={`max-w-[180px] truncate ${isDeleted ? "line-through text-muted-foreground" : ""}`}>
                        {c.subject}
                      </TableCell>
                      <TableCell>{c.opponentName || "-"}</TableCell>
                      <TableCell>
                        {opponentRoleLabel(c.clientRole) ? (
                          <Badge className="bg-orange-500/20 text-orange-600 dark:text-orange-400 border-0">
                            {opponentRoleLabel(c.clientRole)}
                          </Badge>
                        ) : "-"}
                      </TableCell>
                      <TableCell>{c.jurisdiction || "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {getStatusBadge(c.status)}
                          {getOutcomeBadge(c.outcome)}
                        </div>
                      </TableCell>
                      {isManager && (
                        <TableCell onClick={(e) => e.stopPropagation()} className="text-center">
                          {!isDeleted && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              title="حذف القضية"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDelete({ id: c.id, label: c.caseNumber || `ملف #${c.id}` });
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Soft-delete confirm dialog */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              تأكيد حذف القضية
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              هل أنت متأكد من حذف القضية{" "}
              <span className="font-semibold text-foreground">"{confirmDelete?.label}"</span>؟
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">
                ستُعلَّم القضية كمحذوفة مع الاحتفاظ بجميع بياناتها — المذكرات، الجلسات، المستندات، والتنفيذات.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              onClick={handleDelete}
            >
              {deleteCase.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
