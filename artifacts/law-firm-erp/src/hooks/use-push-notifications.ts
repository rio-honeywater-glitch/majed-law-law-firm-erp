import { useCallback, useEffect, useRef, useState } from "react";
import { playNotificationSound } from "@/lib/notification-sound";

const SW_PATH = "/sw.js";

/** Read the stored JWT — same key used by auth.tsx */
function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getVapidKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid-public-key", {
      headers: getAuthHeader(),
    });
    if (!res.ok) return null;
    const data = await res.json() as { vapidPublicKey?: string };
    return data.vapidPublicKey ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function getOrCreateSubscription(
  registration: ServiceWorkerRegistration,
  vapidKey: string,
): Promise<PushSubscription | null> {
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as ArrayBuffer,
    });
  } catch {
    return null;
  }
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.["p256dh"], auth: json.keys?.["auth"] },
    }),
  });
}

export type PushStatus = "unsupported" | "default" | "granted" | "denied";

export interface PushNotificationsState {
  /** Current browser notification permission status */
  status: PushStatus;
  /** Call to explicitly request permission and subscribe */
  requestPermission: () => Promise<void>;
}

/**
 * Manages push notification permission and subscription.
 * Auto-requests permission on mount when status is "default".
 * Also listens for SW postMessage events and plays a sound when a push arrives.
 */
export function usePushNotifications(enabled: boolean): PushNotificationsState {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const [status, setStatus] = useState<PushStatus>(() => {
    if (!supported) return "unsupported";
    return (Notification.permission as PushStatus) ?? "default";
  });

  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);
  const subscribedRef = useRef(false);

  // Register SW and auto-subscribe only when permission was already granted.
  // Never auto-prompt on mount — the user must explicitly click the
  // "Enable notifications" button to trigger requestPermission().
  useEffect(() => {
    if (!enabled || !supported) return;

    navigator.serviceWorker.register(SW_PATH).then(async (reg) => {
      swRegRef.current = reg;

      const perm = Notification.permission as PushStatus;
      setStatus(perm);

      if (perm === "granted" && !subscribedRef.current) {
        // Returning user — silently re-subscribe
        subscribedRef.current = true;
        const key = await getVapidKey();
        if (!key) return;
        const sub = await getOrCreateSubscription(reg, key);
        if (sub) saveSubscription(sub).catch(() => {});
      }
      // "default" or "denied": wait for explicit user action via requestPermission()
    }).catch(() => {});
  }, [enabled, supported]);

  // Listen for SW postMessage (push arrived) → play sound + stamp dedup timestamp
  useEffect(() => {
    if (!enabled || !supported) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_RECEIVED") {
        (window as any).__lastPushSoundAt = Date.now();
        playNotificationSound();
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [enabled, supported]);

  const requestPermission = useCallback(async () => {
    if (!supported) return;
    try {
      const vapidKey = await getVapidKey();
      if (!vapidKey) return;

      let reg = swRegRef.current;
      if (!reg) {
        reg = await navigator.serviceWorker.register(SW_PATH);
        swRegRef.current = reg;
      }

      const perm = await Notification.requestPermission();
      setStatus(perm as PushStatus);
      if (perm !== "granted") return;

      const sub = await getOrCreateSubscription(reg, vapidKey);
      if (sub) {
        await saveSubscription(sub);
        subscribedRef.current = true;
      }
    } catch {
      // silently ignore — push is optional
    }
  }, [supported]);

  return { status, requestPermission };
}
