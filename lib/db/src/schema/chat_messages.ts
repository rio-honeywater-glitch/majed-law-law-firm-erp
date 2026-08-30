import { pgTable, text, serial, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { chatConversationsTable } from "./chat_conversations";

export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull()
    .references(() => chatConversationsTable.id, { onDelete: "cascade" }),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  sources: jsonb("sources").$type<Array<{ id: string; content: string; documentTitle: string }>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChatMessage = typeof chatMessagesTable.$inferSelect;
