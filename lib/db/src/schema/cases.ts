import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { tenantsTable } from "./tenants";

export const caseStatusEnum = pgEnum("case_status", ["UNDER_REVIEW", "APPEAL", "EXECUTION", "CLOSED"]);
export const clientRoleEnum = pgEnum("client_role", ["PLAINTIFF", "DEFENDANT"]);
export const caseOutcomeEnum = pgEnum("case_outcome", ["WON", "LOST", "PENDING"]);

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  jurisdiction: text("jurisdiction"),
  clientRole: clientRoleEnum("client_role"),
  opponentName: text("opponent_name"),
  subject: text("subject"),
  description: text("description"),
  caseNumber: text("case_number"),
  status: caseStatusEnum("status").notNull().default("UNDER_REVIEW"),
  outcome: caseOutcomeEnum("outcome").notNull().default("PENDING"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByName: text("deleted_by_name"),
  deletedByRole: text("deleted_by_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;
