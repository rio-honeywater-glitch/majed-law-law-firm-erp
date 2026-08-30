import { useState, useEffect, useRef } from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useMissedPushNotifications } from "@/hooks/use-missed-push-notifications";
import { playNotificationSound } from "@/lib/notification-sound";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  Scale,
  Gavel,
  Bell,
  BellOff,
  BellRing,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Sparkles,
  ClipboardList,
  Settings,
  UserCog,
  UserCircle,
  AlertTriangle,
  Clock,
  Lock,
  Info,
  ArrowLeft,
  CalendarDays,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useListNotifications,
  useGetSystemSetting,
  useListTasks,
  useGetExecutionTransferOrderSummary,
  useMarkNotificationRead,
  getListNotificationsQueryKey,
  getListTasksQueryKey,
  getGetExecutionTransferOrderSummaryQueryKey,
  getHearing,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { arSA } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

type NotificationItem = {
  id: number;
  type: string;
  message: string;
  relatedEntityId?: number | null;
  relatedEntityType?: string | null;
  isRead: boolean;
  createdAt: string;
};

function getNotificationIcon(type: string) {
  switch (type) {
    case "HEARING_48H_ALERT": return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
    case "EXECUTION_REMINDER": return <Clock className="w-4 h-4 text-destructive shrink-0" />;
    case "HEARING_TRANSCRIPT_LOCK": return <Lock className="w-4 h-4 text-muted-foreground shrink-0" />;
    default: return <Info className="w-4 h-4 text-primary shrink-0" />;
  }
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, branding } = useAuth();
  const firmName = branding?.name || "مكتب محاماة";
  const firmLogoUrl = branding?.logoUrl || null;
  const [location, navigate] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  // Push notifications — explicit permission via button
  const { status: pushStatus, requestPermission } = usePushNotifications(!!user);

  // Missed push notifications — shown once per login session
  const { items: missedPushItems, dismiss: dismissMissedPush } = useMissedPushNotifications(!!user);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const markRead = useMarkNotificationRead();

  const { data: notifications } = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const unreadCount = notifications?.filter((n) => !n.isRead).length || 0;
  const allNotifications = (notifications || []) as NotificationItem[];
  const unreadNotifications = allNotifications.filter((n) => !n.isRead);
  const readNotifications = allNotifications.filter((n) => n.isRead).slice(0, 5);
  const recentNotifications = [...unreadNotifications, ...readNotifications];

  // Play sound when polling detects new unread notifications.
  // Deduplication: if a SW push already played the sound (within 10 s), skip.
  const prevUnreadCountRef = useRef<number | null>(null);
  const lastPushSoundAtRef = useRef<number>(0);

  // Expose a setter so the SW message listener (in usePushNotifications) can stamp the time
  // — done by writing to window.__lastPushSoundAt which we read here.
  useEffect(() => {
    if (prevUnreadCountRef.current === null) {
      prevUnreadCountRef.current = unreadCount;
      return;
    }
    if (unreadCount > prevUnreadCountRef.current) {
      const now = Date.now();
      const msSinceSwSound = now - ((window as any).__lastPushSoundAt ?? 0);
      if (msSinceSwSound > 10_000) {
        // No recent SW-delivered sound — play now
        playNotificationSound();
      }
      // else: SW already played it, skip
    }
    prevUnreadCountRef.current = unreadCount;
  }, [unreadCount]);

  const handleBellNavigate = async (n: NotificationItem) => {
    setNavigatingId(n.id);
    setBellOpen(false);
    try {
      if (!n.isRead) {
        markRead
          .mutateAsync({ id: n.id })
          .then(() => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }))
          .catch(() => undefined);
      }
      if (n.relatedEntityType === "hearing" && n.relatedEntityId) {
        const hearing = await getHearing(n.relatedEntityId);
        navigate(`/cases/${hearing.caseId}?tab=hearings&hearing=${hearing.id}`);
        return;
      }
      if (
        (n.relatedEntityType === "execution" || n.relatedEntityType === "transfer_order_alert") &&
        n.relatedEntityId
      ) {
        navigate(`/executions?execution=${n.relatedEntityId}`);
        return;
      }
      navigate("/tasks");
    } catch {
      toast({ variant: "destructive", title: "تعذر فتح مصدر الإشعار — قد يكون العنصر محذوفاً" });
    } finally {
      setNavigatingId(null);
    }
  };

  const handleEnableNotifications = async () => {
    // If already denied by browser, clicking does nothing (no toast, no text)
    if (pushStatus === "denied") return;
    await requestPermission();
    if (Notification.permission === "granted") {
      toast({ title: "✅ تم تفعيل إشعارات المتصفح" });
    }
  };

  const isManager = user?.role === "SYSTEM_MANAGER";
  const { data: tasksSetting } = useGetSystemSetting("TASKS_MODULE_VISIBLE");
  const tasksVisible = tasksSetting?.value ?? true;

  const { data: allTasks } = useListTasks({}, {
    query: {
      queryKey: getListTasksQueryKey({}),
      enabled: !!tasksVisible,
    },
  });
  const tasksBadgeCount = allTasks?.filter((t) => {
    if (t.status === "COMPLETED") return false;
    const now = new Date();
    if (t.dueDate && new Date(t.dueDate) < now) return true;
    const created = new Date(t.createdAt);
    return (
      created.getFullYear() === now.getFullYear() &&
      created.getMonth() === now.getMonth() &&
      created.getDate() === now.getDate()
    );
  }).length || 0;

  const { data: transferSummary } = useGetExecutionTransferOrderSummary({
    query: {
      queryKey: getGetExecutionTransferOrderSummaryQueryKey(),
      refetchInterval: 60_000,
    },
  });
  const executionBadgeCount = transferSummary?.pendingCount || 0;

  useEffect(() => {
    setIsMobileOpen(false);
  }, [location]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMobileOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const navigation = [
    { name: "لوحة القيادة", href: "/dashboard", icon: LayoutDashboard },
    { name: "العملاء", href: "/clients", icon: Users },
    { name: "القضايا", href: "/cases", icon: Briefcase },
    ...(isManager ? [{ name: "العقود", href: "/contracts", icon: FileText }] : []),
    { name: "الجلسات", href: "/hearings", icon: Scale },
    { name: "التنفيذ", href: "/executions", icon: Gavel, badge: executionBadgeCount },
    ...(tasksVisible ? [{ name: "المهام", href: "/tasks", icon: ClipboardList, badge: tasksBadgeCount }] : []),
    { name: "الإشعارات", href: "/notifications", icon: Bell, badge: unreadCount },
    { name: "الاجتماعات الدورية", href: "/meetings", icon: CalendarDays },
    { name: "دليل الجهات", href: "/moj-directory", icon: BookOpen },
    { name: "المساعد القانوني", href: "/ai-assistant", icon: Sparkles },
    ...(isManager ? [{ name: "الإدارة المالية", href: "/finances", icon: DollarSign }] : []),
    ...(isManager ? [{ name: "إدارة المستخدمين", href: "/users", icon: UserCog }] : []),
    ...(isManager ? [{ name: "الإعدادات", href: "/settings", icon: Settings }] : []),
    { name: "ملف الموظف", href: "/profile", icon: UserCircle },
  ];

  // Push button: only show when permission is "default" (not yet asked) or "denied" (silently)
  const PushIcon = pushStatus === "denied" ? Bell : BellRing;
  const pushButtonTitle =
    pushStatus === "denied"
      ? "الإشعارات غير مفعّلة"
      : "تفعيل إشعارات المتصفح";

  const sidebarContent = (mobile = false) => (
    <div className="flex flex-col h-full">
      {/* Logo & brand */}
      <div className="flex flex-col items-center px-4 py-5 border-b border-sidebar-border/50 gap-2">
        {(!isCollapsed || mobile) ? (
          <>
            <div className="w-16 h-16 rounded-full border-2 border-primary/30 p-1.5 bg-sidebar-accent flex items-center justify-center shrink-0">
              {firmLogoUrl ? (
                <img src={firmLogoUrl} alt="شعار المكتب" className="w-full h-full object-contain" />
              ) : (
                <Scale className="w-8 h-8 text-primary" />
              )}
            </div>
            <h1 className="text-sm font-bold text-primary leading-tight text-center">
              {firmName}
            </h1>
          </>
        ) : (
          <div className="w-10 h-10 rounded-full border border-primary/30 p-1 bg-sidebar-accent flex items-center justify-center">
            {firmLogoUrl ? (
              <img src={firmLogoUrl} alt="شعار المكتب" className="w-full h-full object-contain" />
            ) : (
              <Scale className="w-5 h-5 text-primary" />
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navigation.map((item) => {
          const isActive =
            location === item.href || location.startsWith(item.href + "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              title={isCollapsed && !mobile ? item.name : undefined}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-sm font-medium relative
                ${isCollapsed && !mobile ? "justify-center" : ""}
                ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/75"
                }
              `}
            >
              <item.icon
                className={`w-5 h-5 shrink-0 ${
                  isActive ? "text-primary-foreground" : "text-sidebar-foreground/50"
                }`}
              />
              {(!isCollapsed || mobile) && (
                <span className="flex-1 truncate">{item.name}</span>
              )}
              {(!isCollapsed || mobile) && item.badge !== undefined && item.badge > 0 && (
                <span className="bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                  {item.badge}
                </span>
              )}
              {isCollapsed && !mobile && item.badge !== undefined && item.badge > 0 && (
                <span className="absolute top-1 left-1 w-2 h-2 bg-destructive rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border px-3 py-3 bg-sidebar-accent/20">
        {(!isCollapsed || mobile) ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0 overflow-hidden border border-primary/20">
                {(user as any)?.avatarBase64 ? (
                  <img src={(user as any).avatarBase64} alt="صورة المستخدم" className="w-full h-full object-cover" />
                ) : (
                  user?.name?.charAt(0) || user?.email?.charAt(0) || "م"
                )}
              </div>
              <div className="overflow-hidden flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-sidebar-foreground">
                  {user?.name || "المستخدم"}
                </p>
                <p className="text-xs text-sidebar-foreground/50 truncate">
                  {user?.role === "SYSTEM_MANAGER" ? "مدير النظام" : "ثانوي"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-sidebar-border text-sm"
              onClick={logout}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              تسجيل الخروج
            </Button>
          </>
        ) : (
          <button
            onClick={logout}
            title="تسجيل الخروج"
            className="w-full flex items-center justify-center p-2 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30 text-foreground flex flex-row">

      {/* ─── Desktop Sidebar — FIRST in DOM = RIGHT side in RTL ─── */}
      <aside
        className={`
          hidden md:flex flex-col shrink-0
          bg-sidebar border-l border-sidebar-border text-sidebar-foreground
          transition-all duration-300 ease-in-out
          ${isCollapsed ? "w-16" : "w-64"}
        `}
      >
        {sidebarContent(false)}
      </aside>

      {/* ─── Main content — SECOND in DOM = Left side in RTL ─── */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border flex items-center justify-between px-4 h-14 shrink-0">
          {/* Right side of header (RTL start): toggle + hamburger */}
          <div className="flex items-center gap-2">
            {/* Mobile hamburger */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-foreground/70 hover:text-foreground"
              onClick={() => setIsMobileOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>

            {/* Desktop collapse/expand toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:flex text-foreground/70 hover:text-foreground"
              onClick={() => setIsCollapsed(!isCollapsed)}
              title={isCollapsed ? "توسيع القائمة" : "طي القائمة"}
            >
              {isCollapsed ? (
                <ChevronRight className="w-5 h-5" />
              ) : (
                <ChevronLeft className="w-5 h-5" />
              )}
            </Button>
          </div>

          {/* Left side of header (RTL end): firm name + push button + notification bell */}
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold text-foreground/80 hidden sm:block">
              {firmName}
            </span>
            {firmLogoUrl ? (
              <img
                src={firmLogoUrl}
                alt="شعار المكتب"
                className="w-8 h-8 object-contain rounded-full border border-primary/20"
              />
            ) : (
              <span className="w-8 h-8 rounded-full border border-primary/20 bg-primary/10 flex items-center justify-center">
                <Scale className="w-4 h-4 text-primary" />
              </span>
            )}

            {/* Push notification status icon */}
            {pushStatus !== "unsupported" && pushStatus !== "granted" && (
              <button
                onClick={handleEnableNotifications}
                title={pushButtonTitle}
                className={`
                  relative flex items-center justify-center w-7 h-7 rounded-full
                  transition-all duration-200
                  ${pushStatus === "default"
                    ? "text-primary hover:bg-primary/10 animate-pulse"
                    : "text-foreground/40 hover:bg-muted cursor-default"
                  }
                `}
              >
                <PushIcon className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}

            {/* Granted indicator */}
            {pushStatus === "granted" && (
              <span title="إشعارات المتصفح مفعّلة" className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500/10">
                <BellRing className="w-3.5 h-3.5 text-green-600" />
              </span>
            )}

            {/* Notification bell */}
            <Popover open={bellOpen} onOpenChange={setBellOpen}>
              <PopoverTrigger asChild>
                <button className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors">
                  <Bell className="w-4 h-4 text-foreground/60" />
                  {unreadCount > 0 && (
                    <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-80 p-0 shadow-lg"
                dir="rtl"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-semibold text-sm">الإشعارات</span>
                  {unreadCount > 0 && (
                    <span className="text-xs text-muted-foreground">{unreadCount} غير مقروء</span>
                  )}
                </div>
                <div className="max-h-[360px] overflow-y-auto">
                  {recentNotifications.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد إشعارات
                    </div>
                  ) : (
                    <>
                      {unreadNotifications.length > 0 && (
                        <>
                          <div className="px-4 py-1.5 bg-muted/50 border-b border-border">
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">غير مقروءة</span>
                          </div>
                          <div className="divide-y divide-border">
                            {unreadNotifications.map((n) => (
                              <button
                                key={n.id}
                                onClick={() => handleBellNavigate(n)}
                                disabled={navigatingId === n.id}
                                className="w-full text-right flex items-start gap-3 px-4 py-3 hover:bg-muted/60 transition-colors bg-primary/5"
                              >
                                <div className="mt-0.5">{getNotificationIcon(n.type)}</div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs leading-snug line-clamp-2 font-medium text-foreground">
                                    {n.message}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: arSA })}
                                  </p>
                                </div>
                                <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                                <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      {readNotifications.length > 0 && (
                        <>
                          <div className="px-4 py-1.5 bg-muted/50 border-y border-border">
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">سابقة</span>
                          </div>
                          <div className="divide-y divide-border">
                            {readNotifications.map((n) => (
                              <button
                                key={n.id}
                                onClick={() => handleBellNavigate(n)}
                                disabled={navigatingId === n.id}
                                className="w-full text-right flex items-start gap-3 px-4 py-3 hover:bg-muted/60 transition-colors"
                              >
                                <div className="mt-0.5">{getNotificationIcon(n.type)}</div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs leading-snug line-clamp-2 text-foreground/70">
                                    {n.message}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: arSA })}
                                  </p>
                                </div>
                                <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
                <div className="border-t border-border px-4 py-2.5">
                  <Link
                    href="/notifications"
                    onClick={() => setBellOpen(false)}
                    className="block text-center text-xs text-primary hover:underline font-medium"
                  >
                    عرض الكل
                  </Link>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>

        {/* Missed push notifications banner */}
        {missedPushItems.length > 0 && (
          <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3" dir="rtl">
            <BellRing className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800 mb-1">
                كانت هناك إشعارات فائتة أثناء إغلاق المتصفح ({missedPushItems.length})
              </p>
              <ul className="space-y-1">
                {missedPushItems.map((item) => (
                  <li key={item.id} className="text-xs text-amber-700">
                    {item.message}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-amber-600 hover:text-amber-800 hover:bg-amber-100 h-7 w-7"
              onClick={dismissMissedPush}
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 p-4 md:p-6 xl:p-8 overflow-y-auto flex flex-col">
          <div className="flex-1">{children}</div>
          <footer className="mt-8 pt-4 border-t border-border/60 text-center">
            <p className="text-xs text-muted-foreground">
              تم بناؤه من قبل{" "}
              <a
                href="https://towala.sa/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary hover:underline"
                data-testid="link-towala"
              >
                Towala
              </a>
            </p>
          </footer>
        </div>
      </main>

      {/* ─── Mobile sidebar overlay ─── */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" aria-hidden="true">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileOpen(false)}
          />

          {/* Drawer — slides in from the right */}
          <aside
            className="absolute top-0 right-0 h-full w-72 max-w-[85vw]
              bg-sidebar border-l border-sidebar-border text-sidebar-foreground
              shadow-2xl flex flex-col
              animate-in slide-in-from-right duration-300"
          >
            <div className="flex items-center justify-start px-3 pt-3">
              <Button
                variant="ghost"
                size="icon"
                className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
                onClick={() => setIsMobileOpen(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            {sidebarContent(true)}
          </aside>
        </div>
      )}
    </div>
  );
}
