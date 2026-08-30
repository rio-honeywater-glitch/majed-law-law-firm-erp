import { useState } from "react";
import { useListHearings } from "@workspace/api-client-react";
import type { Hearing } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Scale, AlertTriangle, Lock, Archive } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import { arSA } from "date-fns/locale";
import { useSortable, SortableHead, IndexHead } from "@/components/ui/sortable-table";
import { DateRangeFilter, filterByDateRange, type DateRangeValue } from "@/components/ui/date-range-filter";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter =
  | "ALL"
  | "UPCOMING"
  | "ENDED"
  | "CANCELLED"
  | "LAWSUIT"    // requiresLawsuitEditing
  | "REPLY";     // requiresReplyPrep

// ─── Status badge ─────────────────────────────────────────────────────────────

function HearingStatusBadge({ status }: { status: string }) {
  if (status === "ENDED")
    return <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">منتهية</Badge>;
  if (status === "CANCELLED")
    return <Badge variant="destructive" className="text-xs">ملغاة</Badge>;
  return (
    <Badge className="text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 border">
      قادمة
    </Badge>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { value: StatusFilter; label: string; color?: string }[] = [
  { value: "ALL",      label: "الكل" },
  { value: "UPCOMING", label: "قادمة" },
  { value: "ENDED",    label: "منتهية" },
  { value: "CANCELLED",label: "ملغاة" },
  { value: "LAWSUIT",  label: "تحرير دعوى" },
  { value: "REPLY",    label: "تتطلب رد" },
];

function FilterChips({
  value,
  onChange,
  counts,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
  counts: Partial<Record<StatusFilter, number>>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTER_OPTIONS.map((opt) => {
        const count = counts[opt.value] ?? 0;
        const active = value === opt.value;
        return (
          <Button
            key={opt.value}
            variant={active ? "default" : "outline"}
            size="sm"
            className={`h-7 text-xs gap-1.5 ${active ? "" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
            {opt.value !== "ALL" && (
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 py-0 text-[10px] font-bold min-w-[18px] ${
                  active
                    ? "bg-white/20 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {count}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}

// ─── Apply status filter ──────────────────────────────────────────────────────

function applyStatusFilter<T extends {
  effectiveStatus?: string;
  requiresLawsuitEditing?: boolean;
  requiresReplyPrep?: boolean;
  utcDate: Date | string;
}>(hearings: T[], filter: StatusFilter): T[] {
  if (filter === "ALL") return hearings;
  return hearings.filter((h) => {
    const es = (h.effectiveStatus ?? (new Date(h.utcDate) < new Date() ? "ENDED" : "UPCOMING")) as string;
    if (filter === "UPCOMING")  return es === "UPCOMING";
    if (filter === "ENDED")     return es === "ENDED";
    if (filter === "CANCELLED") return es === "CANCELLED";
    if (filter === "LAWSUIT")   return h.requiresLawsuitEditing === true;
    if (filter === "REPLY")     return h.requiresReplyPrep === true;
    return true;
  });
}

function buildCounts<T extends {
  effectiveStatus?: string;
  requiresLawsuitEditing?: boolean;
  requiresReplyPrep?: boolean;
  utcDate: Date | string;
}>(hearings: T[]): Partial<Record<StatusFilter, number>> {
  const counts: Partial<Record<StatusFilter, number>> = {};
  const allFilters: StatusFilter[] = ["UPCOMING", "ENDED", "CANCELLED", "LAWSUIT", "REPLY"];
  for (const f of allFilters) {
    counts[f] = applyStatusFilter(hearings, f).length;
  }
  return counts;
}

// ─── Hearing table ────────────────────────────────────────────────────────────

function HearingTable({
  hearings,
  isLoading,
  emptyLabel,
  dateFilter,
  statusFilter,
  onStatusFilterChange,
}: {
  hearings: Hearing[] | undefined;
  isLoading: boolean;
  emptyLabel: string;
  dateFilter: DateRangeValue;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
}) {
  const [, navigate] = useLocation();

  // Date-range filtering (reuse createdAt slot for utcDate)
  const dateFiltered = filterByDateRange(
    hearings?.map((h) => ({ ...h, createdAt: h.utcDate })),
    dateFilter,
  ) ?? [];

  // Status filtering
  const statusFiltered = applyStatusFilter(dateFiltered, statusFilter);

  const counts = buildCounts(dateFiltered);

  const { sorted, sortKey, sortDir, toggle } = useSortable(
    statusFiltered,
    {
      hijriDate:      (h) => h.hijriDate,
      utcDate:        (h) => new Date(h.utcDate),
      caseId:         (h) => h.caseId,
      attendance:     (h) => h.attendance,
      effectiveStatus:(h) => (h as any).effectiveStatus ?? "",
    },
    "hearings-sort",
  );
  const sortedHearings = sorted ?? [];

  return (
    <div className="space-y-4">
      {/* Status filter chips */}
      <FilterChips value={statusFilter} onChange={onStatusFilterChange} counts={counts} />

      <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <IndexHead />
              <SortableHead label="التاريخ الهجري"   sortKey="hijriDate"       currentKey={sortKey} dir={sortDir} onToggle={toggle} />
              <SortableHead label="التاريخ الميلادي" sortKey="utcDate"         currentKey={sortKey} dir={sortDir} onToggle={toggle} />
              <SortableHead label="القضية"           sortKey="caseId"          currentKey={sortKey} dir={sortDir} onToggle={toggle} />
              <SortableHead label="الحضور"           sortKey="attendance"      currentKey={sortKey} dir={sortDir} onToggle={toggle} />
              <SortableHead label="الحالة"           sortKey="effectiveStatus" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
              <TableHead className="text-right">تفاصيل</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                </TableCell>
              </TableRow>
            ) : sortedHearings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-32 text-muted-foreground">
                  <Scale className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              sortedHearings.map((h, idx) => {
                const hearingDate = new Date(h.utcDate);
                const isUpcomingWithin48h =
                  hearingDate > new Date() && differenceInHours(hearingDate, new Date()) <= 48;
                const status =
                  (h as any).effectiveStatus ?? (hearingDate < new Date() ? "ENDED" : "UPCOMING");

                return (
                  <TableRow
                    key={h.id}
                    className="group hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/cases/${h.caseId}?tab=hearings&hearing=${h.id}`)}
                  >
                    <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell className="font-medium text-primary">
                      <div className="flex items-center gap-2">
                        {h.hijriDate}
                        {isUpcomingWithin48h && (
                          <span title="خلال 48 ساعة">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{format(hearingDate, "d MMMM yyyy", { locale: arSA })}</TableCell>
                    <TableCell className="text-muted-foreground">{`قضية #${h.caseId}`}</TableCell>
                    <TableCell>{h.attendance || "-"}</TableCell>
                    <TableCell>
                      <HearingStatusBadge status={status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {h.requiresLawsuitEditing && (
                          <Badge variant="destructive" className="text-xs">تحرير دعوى</Badge>
                        )}
                        {h.requiresReplyPrep && (
                          <Badge className="text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 border">
                            تتطلب رد
                          </Badge>
                        )}
                        {h.postHearingLocked && (
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <Lock className="w-3 h-3" /> مقفلة
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Hearings() {
  const [activeTab, setActiveTab]       = useState<"current" | "archive">("current");
  const [dateFilter, setDateFilter]     = useState<DateRangeValue>({ preset: "all" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const { data: allHearings, isLoading } = useListHearings({});

  // Split into current (not locked) and archive (locked)
  const currentHearings = allHearings?.filter((h) => !h.postHearingLocked) ?? [];
  const archivedHearings = allHearings?.filter((h) => h.postHearingLocked) ?? [];

  // Reset status filter when switching tabs
  const handleTabChange = (tab: "current" | "archive") => {
    setActiveTab(tab);
    setStatusFilter("ALL");
  };

  const displayedHearings = activeTab === "current" ? currentHearings : archivedHearings;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Page heading */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight">الجلسات</h2>
          <p className="text-muted-foreground mt-1">سجل الجلسات لجميع القضايا</p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as "current" | "archive")}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <TabsList>
              <TabsTrigger value="current" className="gap-2">
                <Scale className="w-4 h-4" />
                الجلسات الحالية
                {!isLoading && (
                  <span className="text-xs bg-primary/10 text-primary rounded-full px-1.5 py-0 font-bold">
                    {currentHearings.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="archive" className="gap-2">
                <Archive className="w-4 h-4" />
                أرشيف الجلسات
                {!isLoading && archivedHearings.length > 0 && (
                  <span className="text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0 font-bold">
                    {archivedHearings.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Date range filter — shared */}
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          </div>
        </Tabs>

        {/* Table (shared component, different data per tab) */}
        <HearingTable
          hearings={displayedHearings as any}
          isLoading={isLoading}
          emptyLabel={
            activeTab === "archive"
              ? "لا توجد جلسات مؤرشفة"
              : statusFilter !== "ALL"
              ? "لا توجد جلسات تطابق الفلتر المحدد"
              : dateFilter.preset !== "all"
              ? "لا توجد جلسات في الفترة المحددة"
              : "لا توجد جلسات مسجلة"
          }
          dateFilter={dateFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      </div>
    </AppLayout>
  );
}
