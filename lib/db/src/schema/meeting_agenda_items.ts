import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { meetingsTable } from "./meetings";
import { usersTable } from "./users";

export const meetingAgendaItemsTable = pgTable("meeting_agenda_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetingsTable.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  recommendations: text("recommendations"),
  isDone: boolean("is_done").notNull().default(false),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMeetingAgendaItemSchema = createInsertSchema(meetingAgendaItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMeetingAgendaItem = z.infer<typeof insertMeetingAgendaItemSchema>;
export type MeetingAgendaItem = typeof meetingAgendaItemsTable.$inferSelect;
