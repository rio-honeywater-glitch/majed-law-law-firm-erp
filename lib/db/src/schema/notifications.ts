import { pgTable, text, serial, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const notificationTypeEnum = pgEnum("notification_type", [
  "HEARING_48H_ALERT",
  "HEARING_TRANSCRIPT_LOCK",
  "EXECUTION_REMINDER",
  "GENERAL",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  /**
   * Recipient user. NULL = broadcast to all users in the tenant (hearings, executions).
   * Non-null = only visible to this specific user (meeting invites, reminders).
   */
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  message: text("message").notNull(),
  relatedEntityId: integer("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
