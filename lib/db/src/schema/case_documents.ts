import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { casesTable } from "./cases";
import { tenantsTable } from "./tenants";

export const caseDocumentsTable = pgTable("case_documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  fileData: text("file_data").notNull(), // base64-encoded binary content
  submittedToCourt: boolean("submitted_to_court").notNull().default(false),
  courtReplyType: text("court_reply_type"),
  courtNotes: text("court_notes"),
  submittedByName: text("submitted_by_name"),
  submittedByRole: text("submitted_by_role"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  // Soft-delete fields
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByName: text("deleted_by_name"),
  deletedByRole: text("deleted_by_role"),
});

export type CaseDocument = typeof caseDocumentsTable.$inferSelect;
