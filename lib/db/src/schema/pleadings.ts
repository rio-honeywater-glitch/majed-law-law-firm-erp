import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const pleadingStatusEnum = pgEnum("pleading_status", ["DRAFT", "SUBMITTED"]);

export const pleadingsTable = pgTable("pleadings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
  type: text("type"),
  content: text("content"),
  status: pleadingStatusEnum("status").notNull().default("DRAFT"),
  managerNotes: text("manager_notes"),
  addedById: integer("added_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPleadingSchema = createInsertSchema(pleadingsTable).omit({ id: true, createdAt: true });
export type InsertPleading = z.infer<typeof insertPleadingSchema>;
export type Pleading = typeof pleadingsTable.$inferSelect;
