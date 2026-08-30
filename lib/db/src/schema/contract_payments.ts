import { pgTable, serial, integer, numeric, text, timestamp, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { contractsTable } from "./contracts";

export const contractPaymentsTable = pgTable("contract_payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  contractId: integer("contract_id").notNull().references(() => contractsTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  dueDate: date("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContractPaymentSchema = createInsertSchema(contractPaymentsTable).omit({ id: true, createdAt: true });
export type InsertContractPayment = z.infer<typeof insertContractPaymentSchema>;
export type ContractPayment = typeof contractPaymentsTable.$inferSelect;
