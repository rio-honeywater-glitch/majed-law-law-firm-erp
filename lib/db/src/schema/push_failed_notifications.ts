import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

/**
 * Records Expo push notification delivery failures so the mobile app can show
 * a "missed notifications" banner when it reopens after a failure window.
 *
 * A row is inserted each time an Expo push send attempt fails for a given user
 * (network error, Expo API non-ok response, or per-ticket error other than
 * DeviceNotRegistered). The mobile app queries GET /api/notifications/missed-push
 * on startup to check for any unacknowledged failures.
 */
export const pushFailedNotificationsTable = pgTable("push_failed_notifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** The Expo push token that failed delivery */
  endpoint: text("endpoint").notNull(),
  /** Notification title that was not delivered */
  title: text("title").notNull(),
  /** Notification body that was not delivered */
  body: text("body"),
  /** Optional deep-link URL attached to the notification */
  url: text("url"),
  /** Human-readable error reason (Expo ticket error, HTTP status, etc.) */
  failureReason: text("failure_reason"),
  /** When the failure occurred */
  failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  /** When the mobile app acknowledged / dismissed this record — null = not yet seen */
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

export type PushFailedNotification = typeof pushFailedNotificationsTable.$inferSelect;
