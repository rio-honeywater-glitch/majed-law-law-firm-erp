import webpush from "web-push";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  pushSubscriptionsTable,
  pushFailedNotificationsTable,
  expoPushReceiptQueueTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";

const vapidPublicKey = process.env["VAPID_PUBLIC_KEY"];
const vapidPrivateKey = process.env["VAPID_PRIVATE_KEY"];
const vapidSubject = process.env["VAPID_SUBJECT"] ?? "mailto:admin@lawfirm.sa";

let vapidConfigured = false;
if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    vapidConfigured = true;
  } catch (err) {
    logger.error({ err }, "VAPID configuration failed — push notifications disabled");
  }
}

export { vapidPublicKey };

/** Returns true if the endpoint is an Expo push token (native mobile). */
function isExpoToken(endpoint: string): boolean {
  return (
    endpoint.startsWith("ExpoPushToken[") ||
    endpoint.startsWith("ExponentPushToken[")
  );
}

/**
 * Record a confirmed Expo push delivery failure in push_failed_notifications
 * so the mobile app can surface a "missed notifications" banner on next open.
 */
async function recordMissedNotification(
  tenantId: number,
  userId: number,
  endpoint: string,
  payload: { title: string; body?: string; url?: string },
  reason: string,
): Promise<void> {
  try {
    await db.insert(pushFailedNotificationsTable).values({
      tenantId,
      userId,
      endpoint,
      title: payload.title,
      body: payload.body ?? null,
      url: payload.url ?? null,
      failureReason: reason,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to record missed notification in DB");
  }
}

/**
 * Send Web Push (VAPID) to browser / PWA subscriptions.
 * Expo tokens are skipped — handled separately by sendExpoPushToSubscriptions.
 */
async function sendWebPushToSubscriptions(
  subs: Array<{ id: number; endpoint: string; p256dh: string; auth: string }>,
  payload: { title: string; body?: string; url?: string },
): Promise<void> {
  if (!vapidConfigured) return;
  const webPushSubs = subs.filter((s) => !isExpoToken(s.endpoint));
  if (webPushSubs.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.allSettled(
    webPushSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data,
        );
      } catch (err: any) {
        if (err?.statusCode === 410) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        } else {
          logger.warn({ err, endpoint: sub.endpoint }, "web push notification failed");
        }
      }
    }),
  );
}

/**
 * Per-subscription outcome after a send attempt.
 *
 * "accepted"   — Expo returned status "ok"; a ticket ID is in expoTicketId and
 *                has been enqueued for async receipt verification.
 * "error"      — Expo returned an error ticket or the HTTP request failed.
 *                isDeviceGone = true means DeviceNotRegistered (sub deleted).
 */
type SendOutcome =
  | { kind: "accepted"; expoTicketId: string }
  | { kind: "error"; reason: string; isDeviceGone: boolean };

/**
 * Send Expo push notifications and track delivery per user.
 *
 * One "delivery group" UUID is generated per (user, send attempt). Every
 * device subscription for that user in this send shares the same group ID.
 * The receipt-polling cron uses the group to aggregate outcomes:
 *   - Any group member with receipt "ok" → notification was delivered to that device → no banner.
 *   - All group members with receipt "error" → all devices failed → record missed notification.
 *
 * Immediate failures (network error, HTTP error, non-DeviceNotRegistered
 * ticket error) that have no "accepted" counterpart for the same user are also
 * recorded as missed notifications without waiting for receipts.
 */
async function sendExpoPushToSubscriptions(
  subs: Array<{
    id: number;
    endpoint: string;
    tenantId: number;
    userId: number | null;
  }>,
  payload: { title: string; body?: string; url?: string },
): Promise<void> {
  const expoSubs = subs.filter((s) => isExpoToken(s.endpoint));
  if (expoSubs.length === 0) return;

  // Group subscriptions by userId; assign one deliveryGroupId per user
  const userGroups = new Map<
    number,
    { deliveryGroupId: string; subs: typeof expoSubs }
  >();
  for (const sub of expoSubs) {
    if (sub.userId === null) continue; // skip anonymous — can't attribute
    if (!userGroups.has(sub.userId)) {
      userGroups.set(sub.userId, {
        deliveryGroupId: randomUUID(),
        subs: [],
      });
    }
    userGroups.get(sub.userId)!.subs.push(sub);
  }

  // Track per-subscription outcome
  const outcomes = new Map<number, SendOutcome>(); // sub.id → outcome

  const messages = expoSubs.map((sub) => ({
    to: sub.endpoint,
    title: payload.title,
    body: payload.body ?? payload.title,
    data: payload.url ? { url: payload.url } : {},
    sound: "default",
  }));

  const BATCH_SIZE = 100;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchSubs = expoSubs.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const reason = `Expo Push API HTTP ${response.status}`;
        logger.warn({ status: response.status }, reason);
        for (const sub of batchSubs) {
          outcomes.set(sub.id, { kind: "error", reason, isDeviceGone: false });
        }
        continue;
      }

      const result = (await response.json()) as {
        data: Array<{
          status: string;
          id?: string;
          message?: string;
          details?: { error?: string };
        }>;
      };

      await Promise.allSettled(
        result.data.map(async (ticket, j) => {
          const sub = batchSubs[j];
          if (!sub) return;

          if (ticket?.status === "ok" && ticket.id) {
            outcomes.set(sub.id, { kind: "accepted", expoTicketId: ticket.id });

            // Enqueue for async receipt verification.
            // deliveryGroupId groups all tickets for this user/send attempt.
            const userGroup = sub.userId !== null
              ? userGroups.get(sub.userId)
              : undefined;

            if (userGroup && sub.userId !== null) {
              try {
                await db.insert(expoPushReceiptQueueTable).values({
                  tenantId: sub.tenantId,
                  userId: sub.userId,
                  deliveryGroupId: userGroup.deliveryGroupId,
                  expoTicketId: ticket.id,
                  endpoint: sub.endpoint,
                  subscriptionId: sub.id,
                  notificationTitle: payload.title,
                  notificationBody: payload.body ?? null,
                  notificationUrl: payload.url ?? null,
                });
              } catch (err) {
                logger.warn({ err }, "Failed to enqueue Expo receipt check");
              }
            }
          } else if (ticket?.status === "error") {
            const errorCode = ticket.details?.error;
            if (errorCode === "DeviceNotRegistered") {
              await db
                .delete(pushSubscriptionsTable)
                .where(eq(pushSubscriptionsTable.id, sub.id));
              logger.info({ endpoint: sub.endpoint }, "Expo token removed (DeviceNotRegistered)");
              outcomes.set(sub.id, {
                kind: "error",
                reason: "DeviceNotRegistered",
                isDeviceGone: true,
              });
            } else {
              const reason = errorCode ?? ticket.message ?? "unknown Expo ticket error";
              logger.warn({ endpoint: sub.endpoint, reason }, "Expo push ticket error");
              outcomes.set(sub.id, { kind: "error", reason, isDeviceGone: false });
            }
          } else {
            outcomes.set(sub.id, {
              kind: "error",
              reason: "unexpected ticket status",
              isDeviceGone: false,
            });
          }
        }),
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "network error";
      logger.warn({ err }, "Expo push notification batch failed");
      for (const sub of batchSubs) {
        outcomes.set(sub.id, { kind: "error", reason, isDeviceGone: false });
      }
    }
  }

  // Per-user: if NO subscription was accepted, record missed immediately.
  // If at least one was accepted, receipt-polling handles subsequent delivery failures.
  for (const [userId, group] of userGroups.entries()) {
    const anyAccepted = group.subs.some((s) => outcomes.get(s.id)?.kind === "accepted");
    if (anyAccepted) continue;

    // All of this user's subscriptions failed immediately
    const tenantId = group.subs[0]!.tenantId;
    const endpoint = group.subs[0]!.endpoint;
    const reasons = group.subs
      .map((s) => {
        const o = outcomes.get(s.id);
        return o?.kind === "error" ? o.reason : undefined;
      })
      .filter(Boolean)
      .join("; ");

    await recordMissedNotification(
      tenantId,
      userId,
      endpoint,
      payload,
      reasons || "all subscriptions failed immediately",
    );
  }
}

/**
 * Send push to all subscriptions (web + Expo) in a single call.
 */
async function sendPushToSubscriptions(
  subs: Array<{
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
    tenantId: number;
    userId: number | null;
  }>,
  payload: { title: string; body?: string; url?: string },
): Promise<void> {
  await Promise.allSettled([
    sendWebPushToSubscriptions(subs, payload),
    sendExpoPushToSubscriptions(subs, payload),
  ]);
}

/**
 * Send push to every subscription in a tenant (broadcast events like cron reminders).
 */
export async function sendPushToTenant(
  tenantId: number,
  payload: { title: string; body?: string; url?: string },
): Promise<void> {
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.tenantId, tenantId));
  if (subs.length === 0) return;
  await sendPushToSubscriptions(
    subs.map((s) => ({ ...s, tenantId, userId: s.userId ?? null })),
    payload,
  );
}

/**
 * Send push only to specific users within a tenant (targeted events like meeting invites).
 */
export async function sendPushToUsers(
  tenantId: number,
  userIds: number[],
  payload: { title: string; body?: string; url?: string },
): Promise<void> {
  if (userIds.length === 0) return;
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.tenantId, tenantId),
        inArray(pushSubscriptionsTable.userId, userIds),
      ),
    );
  if (subs.length === 0) return;
  await sendPushToSubscriptions(
    subs.map((s) => ({ ...s, tenantId, userId: s.userId ?? null })),
    payload,
  );
}
