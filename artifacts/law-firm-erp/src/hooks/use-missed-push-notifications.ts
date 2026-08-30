import { useState, useEffect, useCallback } from "react";

export interface MissedNotification {
  id: number;
  tenantId: number;
  userId: number | null;
  type: string;
  message: string;
  relatedEntityId: number | null;
  relatedEntityType: string | null;
  isRead: boolean;
  createdAt: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function postAcknowledge(cursor: string): Promise<void> {
  try {
    await fetch(`${BASE}/api/notifications/missed/acknowledge`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ cursor }),
    });
  } catch {
    // Ignore — the checkpoint will be retried next session
  }
}

/**
 * Fetches unread notifications that arrived since the user's last acknowledged
 * checkpoint (lastMissedAckAt in the DB) and shows them as a "missed while
 * offline" banner.
 *
 * Protocol:
 * 1. GET /notifications/missed — returns { items, cursor } without advancing
 *    the checkpoint. The cursor is a stable server-time snapshot taken at the
 *    start of the GET call.
 * 2. If items are present, display the banner.
 * 3. On dismiss, POST /notifications/missed/acknowledge with the cursor from
 *    step 1. The server advances lastMissedAckAt to that cursor — monotonically,
 *    so concurrent requests and retries are safe.
 * 4. If no items, acknowledge the cursor immediately to initialise / advance
 *    the baseline for future sessions (handles first-time users and no-op
 *    sessions safely).
 *
 * Notifications created after the GET cursor but before dismiss are NOT covered
 * by this cursor — they will appear in the next session's GET, ensuring nothing
 * is silently dropped.
 */
export function useMissedPushNotifications(enabled: boolean) {
  const [items, setItems] = useState<MissedNotification[]>([]);
  const [dismissed, setDismissed] = useState(false);
  // Store the cursor returned from GET so acknowledge uses it (not server now)
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/notifications/missed`, {
          headers: getAuthHeaders(),
        });
        if (!res.ok) return;
        const data: { items: MissedNotification[]; cursor: string } = await res.json();
        if (cancelled) return;

        setCursor(data.cursor);

        if (data.items.length > 0) {
          setItems(data.items);
          setDismissed(false);
        } else {
          // No missed items — advance the checkpoint so future sessions have
          // a baseline. This initialises the cursor for new/migrated users.
          await postAcknowledge(data.cursor);
        }
      } catch {
        // silently ignore — missed notifications check is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    // Acknowledge using the cursor from GET (not server now) — this ensures
    // notifications arriving between GET and dismiss are not silently dropped.
    if (cursor) {
      postAcknowledge(cursor);
    }
  }, [cursor]);

  return { items: dismissed ? [] : items, dismiss };
}
