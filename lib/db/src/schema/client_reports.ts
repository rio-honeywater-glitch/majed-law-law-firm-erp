import { pgTable, serial, integer, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { casesTable } from "./cases";

export interface ReportBlock {
  id: string;
  type: "heading" | "text" | "links" | "custom";
  title: string;
  content?: string;
  items?: Array<{ label: string; url?: string; extra?: string }>;
}

export const clientReportsTable = pgTable("client_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id")
    .notNull()
    .references(() => casesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("تقرير العميل"),
  reportData: jsonb("report_data").$type<ReportBlock[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  lastSentTo: text("last_sent_to"),
  lastSentBy: text("last_sent_by"),
});

export const clientReportDeliveriesTable = pgTable("client_report_deliveries", {
  attemptId: text("attempt_id").notNull(),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id")
    .notNull()
    .references(() => casesTable.id, { onDelete: "cascade" }),
  initiatedByUserId: integer("initiated_by_user_id").notNull(),
  requestedReportId: integer("requested_report_id"),
  savedReportId: integer("saved_report_id")
    .references(() => clientReportsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  reportData: jsonb("report_data").$type<ReportBlock[]>().notNull(),
  senderEmail: text("sender_email").notNull(),
  recipient: text("recipient").notNull(),
  sentBy: text("sent_by").notNull(),
  providerMessageId: text("provider_message_id"),
  providerAcceptedAt: timestamp("provider_accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.attemptId] }),
]);

export type ClientReport = typeof clientReportsTable.$inferSelect;
export type InsertClientReport = typeof clientReportsTable.$inferInsert;
export type ClientReportDelivery = typeof clientReportDeliveriesTable.$inferSelect;
