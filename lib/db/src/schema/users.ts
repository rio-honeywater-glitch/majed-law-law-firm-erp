import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const userRoleEnum = pgEnum("user_role", ["SUPER_ADMIN", "SYSTEM_MANAGER", "TECHNICIAN"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: userRoleEnum("role").notNull().default("TECHNICIAN"),
  avatarBase64: text("avatar_base64"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Last time this user had the app open. Updated on every GET /auth/me call
   * as a presence/heartbeat signal. Moves forward continuously during active
   * sessions so notifications created while the user is present are not
   * mistakenly labelled "missed" on the next reload.
   */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /**
   * The checkpoint for "missed notifications". Advanced only after the client
   * has confirmed it rendered the missed-notifications banner (POST /notifications/missed/acknowledge).
   * GET /notifications/missed returns unread rows created after this timestamp.
   * Separating it from lastSeenAt means a dropped/aborted response never
   * silently skips notifications.
   */
  lastMissedAckAt: timestamp("last_missed_ack_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
