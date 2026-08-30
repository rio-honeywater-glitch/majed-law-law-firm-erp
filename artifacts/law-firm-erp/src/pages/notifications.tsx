import { useState, useEffect, useRef, useCallback } from "react";
import { useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, getListNotificationsQueryKey, getHearing } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Loader2, Bell, Check, Info, AlertTriangle, Clock, Lock, ArrowLeft } from "lucide-react";
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

export default function Notifications() {
  const { data: notifications, isLoading } = useListNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  // Track which IDs are being queued for auto-mark (to avoid duplicate calls)
  const pendingAutoRead = useRef<Set<number>>(new Set());
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Immediately refresh notifications when the page mounts so the bell counter
  // in AppLayout updates right away (without waiting for the 30-second poll).
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  }, [queryClient]);

  const scheduleAutoRead = useCallback((id: number) => {
    if (pendingAutoRead.current.has(id)) return;
    pendingAutoRead.current.add(id);
    const timer = setTimeout(async () => {
      try {
        await markRead.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      } catch (e) {
        console.error(e);
      } finally {
        pendingAutoRead.current.delete(id);
        timersRef.current.delete(id);
      }
    }, 1000);
    timersRef.current.set(id, timer);
  }, [markRead, queryClient]);

  const cancelAutoRead = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
      pendingAutoRead.current.delete(id);
    }
  }, []);

  // Set up IntersectionObserver to watch unread notification rows
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = Number((entry.target as HTMLElement).dataset.notificationId);
          if (!id) continue;
          if (entry.isIntersecting) {
            scheduleAutoRead(id);
          } else {
            cancelAutoRead(id);
          }
        }
      },
      { threshold: 0.8 }
    );

    return () => {
      observerRef.current?.disconnect();
      // Clear all pending timers on unmount
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
      pendingAutoRead.current.clear();
    };
  }, [scheduleAutoRead, cancelAutoRead]);

  // Callback ref to attach/detach observer on each unread notification element
  const observeRef = useCallback((el: HTMLDivElement | null, id: number, isRead: boolean) => {
    if (!observerRef.current) return;
    if (el && !isRead) {
      el.dataset.notificationId = String(id);
      observerRef.current.observe(el);
    }
  }, []);

  const handleMarkRead = async (id: number) => {
    cancelAutoRead(id);
    try {
      await markRead.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    } catch (e) {
      console.error(e);
    }
  };

  const handleMarkAllRead = async () => {
    // Cancel all pending auto-reads since we're marking everything read now
    for (const id of timersRef.current.keys()) {
      cancelAutoRead(id);
    }
    try {
      await markAllRead.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    } catch (e) {
      console.error(e);
    }
  };

  const hasTarget = (n: NotificationItem) => {
    if (n.relatedEntityType === "hearing" && n.relatedEntityId) return true;
    if (n.relatedEntityType === "execution" && n.relatedEntityId) return true;
    if (n.relatedEntityType === "transfer_order_alert" && n.relatedEntityId) return true;
    if (n.type === "GENERAL") return true;
    return false;
  };

  const handleNavigate = async (n: NotificationItem) => {
    setNavigatingId(n.id);
    cancelAutoRead(n.id);
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

  const getIconForType = (type: string) => {
    switch (type) {
      case "HEARING_48H_ALERT": return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case "EXECUTION_REMINDER": return <Clock className="w-5 h-5 text-destructive" />;
      case "HEARING_TRANSCRIPT_LOCK": return <Lock className="w-5 h-5 text-muted-foreground" />;
      default: return <Info className="w-5 h-5 text-primary" />;
    }
  };

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">الإشعارات</h2>
            <p className="text-muted-foreground mt-1">تنبيهات النظام ومواعيد الجلسات</p>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={markAllRead.isPending}>
              {markAllRead.isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Check className="w-4 h-4 ml-2" />}
              تحديد الكل كمقروء
            </Button>
          )}
        </div>

        <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : notifications?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Bell className="w-12 h-12 mb-4 opacity-20" />
              <p>لا توجد إشعارات حالياً</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications?.map((notification) => (
                <div
                  key={notification.id}
                  ref={(el) => observeRef(el, notification.id, notification.isRead)}
                  data-notification-id={!notification.isRead ? notification.id : undefined}
                  className={`p-4 flex gap-4 transition-colors ${!notification.isRead ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                >
                  <div className="mt-1 shrink-0">
                    {getIconForType(notification.type)}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm ${!notification.isRead ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {notification.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: arSA })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!notification.isRead && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleMarkRead(notification.id)}
                        title="تحديد كمقروء"
                      >
                        <Check className="w-4 h-4 text-primary" />
                      </Button>
                    )}
                    {hasTarget(notification) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleNavigate(notification)}
                        disabled={navigatingId === notification.id}
                        title="الانتقال إلى المصدر"
                      >
                        {navigatingId === notification.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : (
                          <ArrowLeft className="w-4 h-4 text-primary" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
