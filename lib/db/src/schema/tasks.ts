import { pgTable, text, serial, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
// numericValue added to support non-boolean settings (e.g. TRANSFER_ORDER_ALERT_DAYS)
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { hearingsTable } from "./hearings";
import { casesTable } from "./cases";
import { tenantsTable } from "./tenants";

export const taskTypeEnum = pgEnum("task_type", ["MANUAL", "HEARING_AUTO"]);
export const taskStatusEnum = pgEnum("task_status", ["PENDING", "COMPLETED"]);

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  taskType: taskTypeEnum("task_type").notNull().default("MANUAL"),
  status: taskStatusEnum("status").notNull().default("PENDING"),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  assignedById: integer("assigned_by_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // null = team-wide task, visible to everyone
  assignedToId: integer("assigned_to_id").references(() => usersTable.id, { onDelete: "cascade" }),
  relatedHearingId: integer("related_hearing_id").references(() => hearingsTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id").references(() => casesTable.id, { onDelete: "set null" }),
  linkUrl: text("link_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;

export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: boolean("value").notNull().default(true),
  numericValue: integer("numeric_value"),
  textValue: text("text_value"),
});

export const insertSystemSettingSchema = createInsertSchema(systemSettingsTable).omit({ id: true });
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettingsTable.$inferSelect;
