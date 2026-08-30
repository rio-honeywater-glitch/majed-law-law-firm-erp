import { pgTable, text, serial, timestamp, integer, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const executionStatusEnum = pgEnum("execution_status", [
  "ACTIVE",
  "FULL_PAYMENT",
  "PARTIAL_PAYMENT",
  "SETTLEMENT",
]);

export const executionsTable = pgTable("executions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  executionNumber: text("execution_number"),
  type: text("type"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  lastReminderDate: timestamp("last_reminder_date", { withTimezone: true }),
  lastWithdrawalAt: timestamp("last_withdrawal_at", { withTimezone: true }),
  lastWithdrawalBy: text("last_withdrawal_by"),
  lastTransferOrderAt: timestamp("last_transfer_order_at", { withTimezone: true }),
  status: executionStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExecutionSchema = createInsertSchema(executionsTable).omit({
  id: true,
  createdAt: true,
  remainingAmount: true,
});
export type InsertExecution = z.infer<typeof insertExecutionSchema>;
export type Execution = typeof executionsTable.$inferSelect;

// ── Transfer-order audit log ─────────────────────────────────────────────────
export const transferOrderLogsTable = pgTable("transfer_order_logs", {
  id: serial("id").primaryKey(),
  executionId: integer("execution_id").notNull().references(() => executionsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
});

export type TransferOrderLog = typeof transferOrderLogsTable.$inferSelect;
