import cron from "node-cron";
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import {
  hearingsTable,
  executionsTable,
  notificationsTable,
  systemSettingsTable,
  meetingsTable,
  meetingParticipantsTable,
  expoPushReceiptQueueTable,
  pushFailedNotificationsTable,
  pushSubscriptionsTable,
  clientsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, gte, lte, lt, ne, isNull, isNotNull, or } from "drizzle-orm";
import { logger } from "./logger";
import { sendPushToTenant, sendPushToUsers } from "./push";

const TRANSFER_ORDER_ALERT_DAYS_DEFAULT = 7;
const EXECUTION_REMINDER_DAYS_DEFAULT = 7;

/**
 * Reads a numeric setting from the DB for a given tenant.
 * Falls back to the provided default if not set.
 */
async function getNumericSetting(tenantId: number, key: string, defaultValue: number): Promise<number> {
  try {
    const [row] = await db.select()
      .from(systemSettingsTable)
      .where(
        and(
          eq(systemSettingsTable.tenantId, tenantId),
          eq(systemSettingsTable.key, key)
        )
      )
      .limit(1);
    if (row && row.numericValue != null && row.numericValue > 0) {
      return row.numericValue;
    }
  } catch (err) {
    logger.warn({ err, tenantId }, `Failed to read ${key} setting, using default`);
  }
  return defaultValue;
}

/**
 * Reads the TRANSFER_ORDER_ALERT_DAYS setting from the DB for a given tenant.
 * Falls back to 7 if not set.
 */
async function getTransferOrderAlertDays(tenantId: number): Promise<number> {
  return getNumericSetting(tenantId, "TRANSFER_ORDER_ALERT_DAYS", TRANSFER_ORDER_ALERT_DAYS_DEFAULT);
}

/**
 * 48-Hour Hearing Alert Cron
 * Runs every 30 minutes. If a hearing is exactly 48 hours away (±30min window),
 * sends a notification demanding the "Lawsuit Editing" document upload.
 */
export function start48hHearingCron() {
  cron.schedule("*/30 * * * *", async () => {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() + 47.5 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + 48.5 * 60 * 60 * 1000);

      const hearings = await db
        .select()
        .from(hearingsTable)
        .where(
          and(
            gte(hearingsTable.utcDate, windowStart),
            lte(hearingsTable.utcDate, windowEnd),
            eq(hearingsTable.alertSent48h, false),
            eq(hearingsTable.requiresLawsuitEditing, true)
          )
        );

      for (const hearing of hearings) {
        const msg = `تنبيه: جلسة القضية رقم ${hearing.caseId} خلال 48 ساعة. يجب رفع مستند تعديل لائحة الدعوى.`;
        await db.insert(notificationsTable).values({
          tenantId: hearing.tenantId,
          type: "HEARING_48H_ALERT",
          message: msg,
          relatedEntityId: hearing.id,
          relatedEntityType: "hearing",
          isRead: false,
        });
        await db.update(hearingsTable)
          .set({ alertSent48h: true })
          .where(eq(hearingsTable.id, hearing.id));
        sendPushToTenant(hearing.tenantId, { title: "تنبيه جلسة", body: msg, url: `/cases/${hearing.caseId}` }).catch(() => {});
        logger.info({ hearingId: hearing.id }, "48h hearing alert sent");
      }
    } catch (err) {
      logger.error({ err }, "48h hearing cron error");
    }
  });
  logger.info("48h hearing alert cron scheduled");
}

/**
 * 7-Day Post-Hearing Lock Cron
 * Runs every hour. After a hearing passes, flags it for a mandatory 7-day
 * restriction where the user must upload the transcript and hearing report.
 */
export function startPostHearingLockCron() {
  cron.schedule("0 * * * *", async () => {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Find hearings that have passed but haven't been locked yet
      const pastHearings = await db
        .select()
        .from(hearingsTable)
        .where(
          and(
            lt(hearingsTable.utcDate, now),
            eq(hearingsTable.postHearingLocked, false)
          )
        );

      for (const hearing of pastHearings) {
        const needsUpload = !hearing.transcriptUrl || !hearing.hearingReport;
        if (needsUpload) {
          await db.update(hearingsTable)
            .set({ postHearingLocked: true })
            .where(eq(hearingsTable.id, hearing.id));

          const lockMsg = `مطلوب: رفع محضر الجلسة وتقرير الجلسة للقضية رقم ${hearing.caseId} خلال 7 أيام من تاريخ الجلسة.`;
          await db.insert(notificationsTable).values({
            tenantId: hearing.tenantId,
            type: "HEARING_TRANSCRIPT_LOCK",
            message: lockMsg,
            relatedEntityId: hearing.id,
            relatedEntityType: "hearing",
            isRead: false,
          });
          sendPushToTenant(hearing.tenantId, { title: "إجراء مطلوب", body: lockMsg, url: `/cases/${hearing.caseId}` }).catch(() => {});
          logger.info({ hearingId: hearing.id }, "Post-hearing lock notification sent");
        }
      }
    } catch (err) {
      logger.error({ err }, "Post-hearing lock cron error");
    }
  });
  logger.info("Post-hearing lock cron scheduled");
}

/**
 * 7-Day Execution Reminder Cron
 * Runs daily at 9am. For any active execution not updated in 7 days, sends a reminder.
 */
export function startExecutionReminderCron() {
  cron.schedule("0 9 * * *", async () => {
    try {
      const activeExecutions = await db
        .select()
        .from(executionsTable)
        .where(
          and(
            ne(executionsTable.status, "FULL_PAYMENT"),
            ne(executionsTable.status, "SETTLEMENT")
          )
        );

      for (const execution of activeExecutions) {
        const reminderDays = await getNumericSetting(execution.tenantId, "EXECUTION_REMINDER_DAYS", EXECUTION_REMINDER_DAYS_DEFAULT);
        const thresholdDate = new Date(Date.now() - reminderDays * 24 * 60 * 60 * 1000);
        // Use updatedAt (last real activity) instead of lastReminderDate so reminders
        // are driven by actual execution changes (transfer orders, status, amounts).
        const lastActivity = execution.updatedAt;
        const shouldRemind = !lastActivity || lastActivity < thresholdDate;

        if (shouldRemind) {
          const execMsg = `تذكير: يرجى تحديث حالة التنفيذ رقم ${execution.executionNumber ?? execution.id}. المبلغ المتبقي: ${parseFloat(execution.remainingAmount).toLocaleString("ar-SA")} ريال.`;
          await db.insert(notificationsTable).values({
            tenantId: execution.tenantId,
            type: "EXECUTION_REMINDER",
            message: execMsg,
            relatedEntityId: execution.id,
            relatedEntityType: "execution",
            isRead: false,
          });

          await db.update(executionsTable)
            .set({ lastReminderDate: new Date() })
            .where(eq(executionsTable.id, execution.id));

          sendPushToTenant(execution.tenantId, { title: "تذكير تنفيذ", body: execMsg, url: `/executions/${execution.id}` }).catch(() => {});
          logger.info({ executionId: execution.id }, "Execution reminder sent");
        }
      }
    } catch (err) {
      logger.error({ err }, "Execution reminder cron error");
    }
  });
  logger.info("Execution reminder cron scheduled");
}

/**
 * Daily Transfer-Order Alert Cron
 * Runs daily at 08:00. For every active execution whose lastTransferOrderAt is
 * NULL or older than the configured TRANSFER_ORDER_ALERT_DAYS setting (default: 7),
 * inserts an EXECUTION_REMINDER notification that includes a direct link to the
 * execution page.
 * Deduplication: at most one alert per execution per calendar day (checked via
 * the notifications table using relatedEntityType = "transfer_order_alert").
 */
export function startTransferOrderAlertCron() {
  cron.schedule("0 8 * * *", async () => {
    try {
      const now = new Date();
      // Start of today in UTC (midnight)
      const todayStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );

      // All active executions (across all tenants)
      const activeExecutions = await db
        .select()
        .from(executionsTable)
        .where(
          and(
            ne(executionsTable.status, "FULL_PAYMENT"),
            ne(executionsTable.status, "SETTLEMENT")
          )
        );

      for (const execution of activeExecutions) {
        // Read per-tenant alert days setting
        const alertDays = await getTransferOrderAlertDays(execution.tenantId);
        const thresholdDate = new Date(now.getTime() - alertDays * 24 * 60 * 60 * 1000);

        // Skip if a transfer order was recorded within the alert window
        if (
          execution.lastTransferOrderAt &&
          execution.lastTransferOrderAt >= thresholdDate
        ) {
          continue;
        }

        // Dedup: skip if we already sent a transfer-order alert today
        const existing = await db
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.tenantId, execution.tenantId),
              eq(notificationsTable.relatedEntityId, execution.id),
              eq(notificationsTable.relatedEntityType, "transfer_order_alert"),
              gte(notificationsTable.createdAt, todayStart)
            )
          )
          .limit(1);

        if (existing.length > 0) continue;

        const label = execution.executionNumber ?? `#${execution.id}`;
        const daysSince = execution.lastTransferOrderAt
          ? Math.floor(
              (now.getTime() - execution.lastTransferOrderAt.getTime()) /
                (24 * 60 * 60 * 1000)
            )
          : null;
        const lastOrderDateText = execution.lastTransferOrderAt
          ? execution.lastTransferOrderAt.toLocaleDateString("ar-SA-u-nu-latn", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })
          : null;
        const sinceText =
          daysSince !== null && lastOrderDateText !== null
            ? `— آخر أمر تحويل بتاريخ ${lastOrderDateText} (منذ ${daysSince} يوم)`
            : "ولم يُسجَّل أي أمر تحويل حتى الآن";

        const toMsg = `تنبيه: تجاوز التنفيذ ${label} حد التنبيه المضبوط (${alertDays} يوم) دون تسجيل أمر تحويل ${sinceText}. يُرجى تسجيل أمر التحويل.`;
        await db.insert(notificationsTable).values({
          tenantId: execution.tenantId,
          type: "EXECUTION_REMINDER",
          message: `${toMsg} /executions/${execution.id}`,
          relatedEntityId: execution.id,
          relatedEntityType: "transfer_order_alert",
          isRead: false,
        });

        sendPushToTenant(execution.tenantId, { title: "تنبيه أمر تحويل", body: toMsg, url: `/executions/${execution.id}` }).catch(() => {});
        logger.info(
          { executionId: execution.id, tenantId: execution.tenantId },
          "Transfer order alert sent"
        );
      }
    } catch (err) {
      logger.error({ err }, "Transfer order alert cron error");
    }
  });
  logger.info("Transfer order alert cron scheduled");
}

/**
 * Meeting Reminder Cron
 * Runs every minute. For meetings whose reminder time has passed (scheduledAt - reminderMinutes <= now),
 * sends one notification per participant that hasn't received it yet.
 */
export function startMeetingReminderCron() {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();

      // Find all upcoming meetings where reminder window has been reached
      // We query meetings scheduled in the future (or just passed) and check reminder time
      const meetings = await db
        .select()
        .from(meetingsTable)
        .where(gte(meetingsTable.scheduledAt, now));

      for (const meeting of meetings) {
        const reminderAt = new Date(
          meeting.scheduledAt.getTime() - meeting.reminderMinutes * 60 * 1000,
        );

        // Only send if reminder time has passed
        if (now < reminderAt) continue;

        // Find participants who haven't received a reminder yet
        const participants = await db
          .select()
          .from(meetingParticipantsTable)
          .where(
            and(
              eq(meetingParticipantsTable.meetingId, meeting.id),
              eq(meetingParticipantsTable.reminderSent, false),
            ),
          );

        if (!participants.length) continue;

        const scheduledDate = meeting.scheduledAt.toLocaleString("ar-SA", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const meetingMsg = `تذكير: اجتماع "${meeting.title}" بعد ${meeting.reminderMinutes} دقيقة — ${scheduledDate}`;
        await db.insert(notificationsTable).values(
          participants.map((p) => ({
            tenantId: meeting.tenantId,
            userId: p.userId,
            type: "GENERAL" as const,
            message: meetingMsg,
            relatedEntityId: meeting.id,
            relatedEntityType: "meeting",
            isRead: false,
          })),
        );
        sendPushToUsers(meeting.tenantId, participants.map(p => p.userId), { title: "تذكير اجتماع", body: meetingMsg, url: `/meetings` }).catch(() => {});

        await db
          .update(meetingParticipantsTable)
          .set({ reminderSent: true })
          .where(eq(meetingParticipantsTable.meetingId, meeting.id));

        logger.info(
          { meetingId: meeting.id, count: participants.length },
          "Meeting reminders sent",
        );
      }
    } catch (err) {
      logger.error({ err }, "meeting reminder cron error");
    }
  });
  logger.info("Meeting reminder cron scheduled");
}

/**
 * Expo Push Receipt Polling Cron
 *
 * Runs every 5 minutes. Polls the Expo getReceipts API for accepted tickets
 * queued in expo_push_receipt_queue and evaluates per-user delivery outcomes
 * grouped by deliveryGroupId:
 *
 *   - If ANY ticket in the group has receipt "ok" → delivered to that device
 *     → no missed notification recorded for the group.
 *   - If ALL tickets in the group have receipt "error" → all devices failed
 *     → one missed notification recorded so the mobile banner appears.
 *
 * DeviceNotRegistered receipts trigger deletion of the exact push subscription
 * using the stored subscriptionId (or endpoint fallback).
 *
 * Entries older than 24 h without a receipt are marked stale and cleaned up.
 */
export function startExpoReceiptPollingCron() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const now = new Date();
      const minAge = new Date(Date.now() - 30_000);         // 30 s — give Expo time to process
      const staleAge = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 h

      // Fetch up to 300 unchecked tickets old enough for receipts to be available
      const pending = await db
        .select()
        .from(expoPushReceiptQueueTable)
        .where(
          and(
            isNull(expoPushReceiptQueueTable.checkedAt),
            lt(expoPushReceiptQueueTable.createdAt, minAge),
          ),
        )
        .limit(300);

      if (pending.length === 0) return;

      // ── 1. Poll Expo for receipts ──────────────────────────────────────────
      let receiptData: Record<
        string,
        { status: string; message?: string; details?: { error?: string } }
      > = {};

      try {
        const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ids: pending.map((e) => e.expoTicketId) }),
        });
        if (!response.ok) {
          logger.warn({ status: response.status }, "Expo getReceipts API request failed");
          return;
        }
        const body = (await response.json()) as { data: typeof receiptData };
        receiptData = body.data;
      } catch (err) {
        logger.warn({ err }, "Expo receipt polling request failed");
        return;
      }

      // ── 2. Update each queue row with its receipt outcome ─────────────────
      await Promise.allSettled(
        pending.map(async (entry) => {
          const receipt = receiptData[entry.expoTicketId];

          if (!receipt) {
            // Receipt not yet available — retry next run unless stale
            if (entry.createdAt < staleAge) {
              await db
                .update(expoPushReceiptQueueTable)
                .set({ checkedAt: now, receiptStatus: "stale" })
                .where(eq(expoPushReceiptQueueTable.id, entry.id));
            }
            return;
          }

          const errorCode = receipt.status === "error"
            ? (receipt.details?.error ?? receipt.message ?? "error")
            : null;

          await db
            .update(expoPushReceiptQueueTable)
            .set({
              checkedAt: now,
              receiptStatus: receipt.status, // "ok" | "error"
              errorCode,
            })
            .where(eq(expoPushReceiptQueueTable.id, entry.id));

          // DeviceNotRegistered: delete the exact subscription using the stored ID / endpoint
          if (receipt.status === "error" && errorCode === "DeviceNotRegistered") {
            if (entry.subscriptionId != null) {
              await db
                .delete(pushSubscriptionsTable)
                .where(eq(pushSubscriptionsTable.id, entry.subscriptionId));
              logger.info(
                { subscriptionId: entry.subscriptionId, endpoint: entry.endpoint },
                "Expo receipt: DeviceNotRegistered — subscription deleted",
              );
            } else {
              // Fallback: match by endpoint in case the subscription ID was lost
              await db
                .delete(pushSubscriptionsTable)
                .where(eq(pushSubscriptionsTable.endpoint, entry.endpoint));
              logger.info(
                { endpoint: entry.endpoint },
                "Expo receipt: DeviceNotRegistered — subscription deleted by endpoint",
              );
            }
          }
        }),
      );

      // ── 3. Evaluate completed delivery groups ─────────────────────────────
      // A group is "complete" when every member has been checked (checkedAt IS NOT NULL).
      // We re-query checked entries so newly-checked rows from step 2 are included.
      //
      // Collect the distinct deliveryGroupIds we just touched.
      const touchedGroupIds = [...new Set(pending.map((e) => e.deliveryGroupId))];

      // For each group, load all its members and decide whether to record a miss.
      await Promise.allSettled(
        touchedGroupIds.map(async (groupId) => {
          const groupMembers = await db
            .select()
            .from(expoPushReceiptQueueTable)
            .where(eq(expoPushReceiptQueueTable.deliveryGroupId, groupId));

          if (groupMembers.length === 0) return;

          const allChecked = groupMembers.every((m) => m.checkedAt !== null);
          if (!allChecked) return; // some tickets still pending — wait

          // If ANY member received "ok" → notification reached at least one device
          const anyOk = groupMembers.some((m) => m.receiptStatus === "ok");
          if (anyOk) {
            logger.debug({ groupId }, "Expo delivery group: at least one device received OK receipt");
            return;
          }

          // All members failed — record one missed notification for the user
          const first = groupMembers[0]!;
          if (!first.userId) return; // anonymous — can't attribute

          await db.insert(pushFailedNotificationsTable).values({
            tenantId: first.tenantId,
            userId: first.userId,
            endpoint: first.endpoint,
            title: first.notificationTitle,
            body: first.notificationBody ?? null,
            url: first.notificationUrl ?? null,
            failureReason: groupMembers
              .map((m) => m.errorCode ?? "unknown")
              .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
              .join("; "),
          });

          logger.warn(
            { groupId, userId: first.userId, count: groupMembers.length },
            "Expo delivery group: all receipts failed — missed notification recorded",
          );
        }),
      );

      logger.debug({ checked: pending.length }, "Expo receipt poll completed");
    } catch (err) {
      logger.error({ err }, "Expo receipt polling cron error");
    }
  });
  logger.info("Expo push receipt polling cron scheduled");
}

/**
 * Push Failed Notifications Cleanup Cron
 * Runs daily at 02:00. Deletes all rows in push_failed_notifications that are
 * older than 30 days, regardless of whether they have been acknowledged.
 * Acknowledged rows are no longer useful; unacknowledged rows older than 30 days
 * belong to users who will never open the app during that window.
 */
export function startPushFailedNotificationsCleanupCron() {
  cron.schedule("0 2 * * *", async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await db
        .delete(pushFailedNotificationsTable)
        .where(lt(pushFailedNotificationsTable.failedAt, cutoff));
      logger.info({ cutoff }, "push_failed_notifications cleanup complete");
    } catch (err) {
      logger.error({ err }, "push_failed_notifications cleanup cron error");
    }
  });
  logger.info("push_failed_notifications cleanup cron scheduled");
}

const AGENCY_ALERT_STAGES = new Map<number, { key: string; text: string }>([
  [7, { key: "before_7", text: "ستنتهي بعد 7 أيام" }],
  [3, { key: "before_3", text: "ستنتهي بعد 3 أيام" }],
  [0, { key: "expires_today", text: "تنتهي اليوم" }],
  [-2, { key: "expired_2", text: "انتهت منذ يومين" }],
]);

export function getAgencyAlertStage(daysUntilExpiry: number) {
  return AGENCY_ALERT_STAGES.get(daysUntilExpiry) ?? null;
}

export function agencyAlertRelatedEntityType(
  stageKey: string,
  agencyEndDate: string,
  agencyNumber: string | null,
  agencySource: string | null,
): string {
  const agencyInstance = createHash("sha256")
    .update(JSON.stringify([agencyEndDate, agencyNumber ?? "", agencySource ?? ""]))
    .digest("hex")
    .slice(0, 16);
  return `client_agency_${stageKey}_${agencyInstance}`;
}

function riyadhDateString(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function daysBetweenDateStrings(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
      / (24 * 60 * 60 * 1000),
  );
}

export async function runAgencyExpirationCheck(now = new Date()) {
  const today = riyadhDateString(now);
  const clients = await db.select().from(clientsTable)
    .where(isNotNull(clientsTable.agencyEndDate));

  for (const client of clients) {
    if (!client.agencyEndDate) continue;
    const stage = getAgencyAlertStage(daysBetweenDateStrings(today, client.agencyEndDate));
    if (!stage) continue;

    const recipients = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.tenantId, client.tenantId),
        or(eq(usersTable.role, "SYSTEM_MANAGER"), eq(usersTable.role, "TECHNICIAN")),
      ));
    const relatedEntityType = agencyAlertRelatedEntityType(
      stage.key,
      client.agencyEndDate,
      client.agencyNumber,
      client.agencySource,
    );
    const message = `تنبيه وكالة: وكالة العميل ${client.name} ${stage.text} (${client.agencyEndDate}).`;
    const insertedUserIds: number[] = [];

    for (const recipient of recipients) {
      const [existing] = await db.select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(and(
          eq(notificationsTable.tenantId, client.tenantId),
          eq(notificationsTable.userId, recipient.id),
          eq(notificationsTable.relatedEntityId, client.id),
          eq(notificationsTable.relatedEntityType, relatedEntityType),
        ))
        .limit(1);
      if (existing) continue;

      await db.insert(notificationsTable).values({
        tenantId: client.tenantId,
        userId: recipient.id,
        type: "GENERAL",
        message,
        relatedEntityId: client.id,
        relatedEntityType,
        isRead: false,
      });
      insertedUserIds.push(recipient.id);
    }

    if (insertedUserIds.length > 0) {
      sendPushToUsers(client.tenantId, insertedUserIds, {
        title: "تنبيه انتهاء وكالة",
        body: message,
        url: `/clients/${client.id}`,
      }).catch((err) => logger.warn({ err, clientId: client.id }, "Agency expiry push failed"));
      logger.info({ clientId: client.id, stage: stage.key, recipients: insertedUserIds.length }, "Agency expiry notifications created");
    }
  }
}

export function startAgencyExpirationCron() {
  cron.schedule("0 9 * * *", async () => {
    try {
      await runAgencyExpirationCheck();
    } catch (err) {
      logger.error({ err }, "Agency expiration cron error");
    }
  }, { timezone: "Asia/Riyadh" });
  logger.info("Agency expiration cron scheduled");
}

export function startAllCronJobs() {
  start48hHearingCron();
  startPostHearingLockCron();
  startExecutionReminderCron();
  startTransferOrderAlertCron();
  startMeetingReminderCron();
  startExpoReceiptPollingCron();
  startPushFailedNotificationsCleanupCron();
  startAgencyExpirationCron();
  logger.info("All cron jobs started");
}
