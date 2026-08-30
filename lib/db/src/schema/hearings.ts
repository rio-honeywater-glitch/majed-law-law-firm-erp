import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { tenantsTable } from "./tenants";

export const hearingsTable = pgTable("hearings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  hijriDate: text("hijri_date").notNull(),
  utcDate: timestamp("utc_date", { withTimezone: true }).notNull(),
  attendance: text("attendance"),
  transcriptUrl: text("transcript_url"),
  hearingReport: text("hearing_report"),
  notes: text("notes"),
  sessionLink: text("session_link"),
  requiresLawsuitEditing: boolean("requires_lawsuit_editing").notNull().default(true),
  requiresReplyPrep: boolean("requires_reply_prep").notNull().default(false),
  alertSent48h: boolean("alert_sent_48h").notNull().default(false),
  postHearingLocked: boolean("post_hearing_locked").notNull().default(false),
  /**
   * Manual status override. NULL = auto-derived:
   *   utcDate < now  → ENDED
   *   utcDate >= now → UPCOMING
   */
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHearingSchema = createInsertSchema(hearingsTable).omit({
  id: true,
  createdAt: true,
  alertSent48h: true,
  postHearingLocked: true,
});
export type InsertHearing = z.infer<typeof insertHearingSchema>;
export type Hearing = typeof hearingsTable.$inferSelect;
