import { pgTable, text, serial, timestamp, integer, boolean, numeric, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { tenantsTable } from "./tenants";

export const serviceTypeEnum = pgEnum("service_type", [
  "FULL_REP",
  "PARTIAL_REP",
  "OBJECTION",
  "CASSATION_REQUEST",
  "CONTRACT_DRAFTING",
  "CONTRACT_REVIEW",
  "LEGAL_CONTRACT_CREATION",
  "CONSULTATION",
]);

export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  serviceType: serviceTypeEnum("service_type").notNull(),
  hijriDate: text("hijri_date").notNull(),
  gregorianDate: text("gregorian_date"),
  // Supplemental client details for the contract document
  clientNationalId: text("client_national_id"),
  clientAddress: text("client_address"),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  // Case linkage (free-text, no FK)
  caseNumber: text("case_number"),
  courtName: text("court_name"),
  caseSubject: text("case_subject"),
  representationScope: text("representation_scope"),
  preamble: text("preamble"),
  fees: numeric("fees", { precision: 12, scale: 2 }),
  feeInstallments: jsonb("fee_installments").$type<Array<{ description: string; amount: number; refundable: boolean }>>(),
  isSigned: boolean("is_signed").notNull().default(false),
  customClauses: jsonb("custom_clauses").$type<string[]>().notNull().default([]),
  seqNumber: integer("seq_number"),
  pdfUrl: text("pdf_url"),
  signedPdfUrl: text("signed_pdf_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContractSchema = createInsertSchema(contractsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contractsTable.$inferSelect;
