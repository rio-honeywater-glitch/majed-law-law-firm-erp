import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Tracks Expo push ticket IDs pending receipt verification.
 *
 * When Expo's /push/send returns status "ok" for a ticket, the notification
 * was accepted but delivery is not yet confirmed. Expo provides delivery
 * receipts via /push/getReceipts after a short delay.
 *
 * All tickets from a single "send to user" attempt share a deliveryGroupId.
 * The receipt-polling cron evaluates the full group:
 *   - If any ticket in the group succeeds → no missed notification recorded.
 *   - If all tickets fail → one missed notification is recorded.
 *
 * This ensures a user with multiple devices does not see a false "missed
 * notification" banner when at least one device received the message.
 */
export const expoPushReceiptQueueTable = pgTable("expo_push_receipt_queue", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /**
   * UUID generated once per (user, notification send) and shared across all
   * device tickets for that send attempt. Used to aggregate per-user delivery
   * outcomes before deciding whether to record a missed notification.
   */
  deliveryGroupId: text("delivery_group_id").notNull(),
  /** Expo ticket ID returned by /push/send (status "ok") */
  expoTicketId: text("expo_ticket_id").notNull(),
  /**
   * Expo push token (endpoint) for this device. Retained even after the
   * push_subscriptions row is deleted, so receipt-time DeviceNotRegistered
   * errors can clean up the correct subscription.
   */
  endpoint: text("endpoint").notNull(),
  /** push_subscriptions.id at send time — used to delete the exact row on DeviceNotRegistered */
  subscriptionId: integer("subscription_id"),
  /** Notification payload — needed to record a missed notification on failure */
  notificationTitle: text("notification_title").notNull(),
  notificationBody: text("notification_body"),
  notificationUrl: text("notification_url"),
  /** When this entry was enqueued */
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** When the receipt was checked (null = still pending) */
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  /** Receipt outcome: "ok" | "error" | null (null = not yet checked) */
  receiptStatus: text("receipt_status"),
  /** Expo error code when receiptStatus = "error" (e.g. "DeviceNotRegistered") */
  errorCode: text("error_code"),
});

export type ExpoPushReceiptQueue = typeof expoPushReceiptQueueTable.$inferSelect;
