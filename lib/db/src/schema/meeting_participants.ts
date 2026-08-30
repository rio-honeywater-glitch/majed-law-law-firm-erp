import { pgTable, serial, integer, boolean, pgEnum, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { meetingsTable } from "./meetings";
import { usersTable } from "./users";

export const rsvpStatusEnum = pgEnum("rsvp_status", ["ATTENDING", "DECLINED", "UNCERTAIN", "PENDING"]);

export const meetingParticipantsTable = pgTable("meeting_participants", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetingsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  rsvpStatus: rsvpStatusEnum("rsvp_status").notNull().default("PENDING"),
  reminderSent: boolean("reminder_sent").notNull().default(false),
  canEditAllAgenda: boolean("can_edit_all_agenda").notNull().default(false),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMeetingParticipantSchema = createInsertSchema(meetingParticipantsTable).omit({ id: true, addedAt: true });
export type InsertMeetingParticipant = z.infer<typeof insertMeetingParticipantSchema>;
export type MeetingParticipant = typeof meetingParticipantsTable.$inferSelect;
