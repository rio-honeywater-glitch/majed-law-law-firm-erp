import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetDashboardSummary, useGetUpcomingHearings, useGetRecentActivity, useGetCaseStatusBreakdown } from "@workspace/api-client-react";
import {
  Users,
  Briefcase,
  Scale,
  Gavel,
  Loader2,
  ArrowLeft,
  FileText,
  FileSignature,
  History,
  Trophy,
  XCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale";
import { Link } from "wouter";

const ACTIVITY_META: Record<
  string,
  { label: string; icon: typeof Users; color: string; bg: string }
> = {
  CLIENT_CREATED: { label: "موكل جديد", icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
  CASE_CREATED: { label: "قضية جديدة", icon: Briefcase, color: "text-amber-500", bg: "bg-amber-500/10" },
  HEARING_CREATED: { label: "جلسة جديدة", icon: Scale, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  PLEADING_CREATED: { label: "مذكرة جديدة", icon: FileText, color: "text-violet-500", bg: "bg-violet-500/10" },
  CONTRACT_CREATED: { label: "عقد جديد", icon: FileSignature, color: "text-primary", bg: "bg-primary/10" },
  EXECUTION_CREATED: { label: "تنفيذ جديد", icon: Gavel, color: "text-rose-500", bg: "bg-rose-500/10" },
};

const DEFAULT_ACTIVITY_META = {
  label: "نشاط",
  icon: History,
  color: "text-muted-foreground",
  bg: "bg-muted",
};

const HEARING_RANGES = [
  { days: 7, label: "خلال 7 أيام" },
  { days: 30, label: "خلال 30 يوم" },
  { days: 60, label: "خلال 60 يوم" },
] as const;

export default function Dashboard() {
  const { isManager } = useAuth();
  const [hearingDays, setHearingDays] = useState<7 | 30 | 60>(7);

  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: hearings, isLoading: isLoadingHearings } = useGetUpcomingHearings({ days: hearingDays });
  const { data: activities, isLoading: isLoadingActivity } = useGetRecentActivity();
  const { data: breakdown, isLoading: isLoadingBreakdown } = useGetCaseStatusBreakdown();

  const stats = [
    {
      title: "إجمالي العملاء",
      value: summary?.totalClients || 0,
      icon: Users,
      href: "/clients",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "القضايا النشطة",
      value: summary?.activeCases || 0,
      icon: Briefcase,
      href: "/cases",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
    {
      title: "القضايا الناجحة",
      value: summary?.wonCases || 0,
      icon: Trophy,
      href: "/cases?outcome=WON",
      color: "text-green-600 dark:text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      title: "القضايا الخاسرة",
      value: summary?.lostCases || 0,
      icon: XCircle,
      href: "/cases?outcome=LOST",
      color: "text-red-600 dark:text-red-500",
      bgColor: "bg-red-500/10",
    },
    {
      title: "الجلسات القادمة",
      value: summary?.upcomingHearingsCount || 0,
      icon: Scale,
      href: "/hearings",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      title: "التنفيذات النشطة",
      value: summary?.activeExecutions || 0,
      icon: Gavel,
      href: "/executions",
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
    },
  ];

  if (isLoadingSummary || isLoadingActivity || isLoadingBreakdown) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">نظرة عامة</h2>
          <p className="text-muted-foreground mt-1">ملخص نشاط المكتب القانوني</p>
        </div>

        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat, i) => (
            <Link key={i} href={stat.href} className="block group">
              <Card className="hover:border-primary/50 transition-colors h-full">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className={`p-4 rounded-full ${stat.bgColor}`}>
                    <stat.icon className={`w-6 h-6 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                    <h3 className="text-3xl font-bold mt-1">{stat.value}</h3>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          {/* Upcoming Hearings */}
          <Card className="lg:col-span-2 flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <CardTitle className="text-lg">الجلسات القادمة</CardTitle>
                <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-1">
                  {HEARING_RANGES.map((r) => (
                    <button
                      key={r.days}
                      type="button"
                      onClick={() => setHearingDays(r.days)}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${
                        hearingDays === r.days
                          ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <Link href="/hearings" className="text-sm text-primary hover:underline flex items-center gap-1">
                عرض الكل <ArrowLeft className="w-4 h-4" />
              </Link>
            </CardHeader>
            <CardContent className="flex-1">
              {isLoadingHearings ? (
                <div className="flex items-center justify-center min-h-[200px]">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : hearings && hearings.length > 0 ? (
                <div className="space-y-4">
                  {hearings.slice(0, 5).map((hearing) => (
                    <div key={hearing.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border bg-card/50 gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-primary">{hearing.clientName || "غير محدد"}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">رقم: {hearing.caseNumber}</span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          التاريخ الهجري: <span className="text-foreground">{hearing.hijriDate}</span>
                        </p>
                      </div>
                      <div className="text-left sm:text-right text-sm font-medium shrink-0">
                        {format(new Date(hearing.utcDate), "EEEE, d MMMM yyyy", { locale: arSA })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground space-y-3">
                  <Scale className="w-10 h-10 opacity-20" />
                  <p>لا توجد جلسات مجدولة {HEARING_RANGES.find((r) => r.days === hearingDays)?.label}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                أحدث النشاطات
              </CardTitle>
              {activities && activities.length > 0 && (
                <span className="text-xs text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-full">
                  {activities.length.toLocaleString("ar-SA")} نشاط
                </span>
              )}
            </CardHeader>
            <CardContent className="flex-1 pt-0">
              {activities && activities.length > 0 ? (
                <div className="relative">
                  {/* Timeline line — anchored to the start (right in RTL) */}
                  <div className="absolute top-2 bottom-2 start-[19px] w-px bg-gradient-to-b from-border via-border to-transparent" />
                  <div className="space-y-1">
                    {activities.slice(0, 6).map((activity) => {
                      const meta = ACTIVITY_META[activity.type] ?? DEFAULT_ACTIVITY_META;
                      const Icon = meta.icon;
                      return (
                        <div
                          key={activity.id}
                          className="relative flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/40 transition-colors group"
                        >
                          <div
                            className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full shrink-0 ring-4 ring-background ${meta.bg}`}
                          >
                            <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className={`text-xs font-semibold ${meta.color}`}>
                                {meta.label}
                              </span>
                              <time
                                className="text-[11px] text-muted-foreground shrink-0"
                                title={format(new Date(activity.createdAt), "d MMMM yyyy، h:mm a", { locale: arSA })}
                              >
                                {formatDistanceToNow(new Date(activity.createdAt), {
                                  addSuffix: true,
                                  locale: arSA,
                                })}
                              </time>
                            </div>
                            <p className="text-sm text-foreground/80 leading-relaxed line-clamp-2">
                              {activity.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground gap-3">
                  <History className="w-10 h-10 opacity-20" />
                  <p className="text-sm">لا توجد نشاطات حديثة</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}