import { pgTable, text, serial, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mojDirectoryTable = pgTable(
  "moj_directory",
  {
    id: serial("id").primaryKey(),
    courtName: text("court_name").notNull(),
    emailAddress: text("email_address").notNull(),
  },
  (table) => [index("moj_directory_court_name_idx").on(table.courtName)],
);

export const insertMojDirectorySchema = createInsertSchema(mojDirectoryTable).omit({
  id: true,
});
export type InsertMojDirectory = z.infer<typeof insertMojDirectorySchema>;
export type MojDirectory = typeof mojDirectoryTable.$inferSelect;
