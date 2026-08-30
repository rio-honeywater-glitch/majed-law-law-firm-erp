import { pgTable, text, uuid, integer, vector, index } from "drizzle-orm/pg-core";
import { legalDocumentsTable } from "./legal_documents";
import { tenantsTable } from "./tenants";

export const legalChunksTable = pgTable(
  "legal_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => legalDocumentsTable.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (table) => [
    index("legal_chunks_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("legal_chunks_document_id_idx").on(table.documentId),
  ],
);

export type LegalChunk = typeof legalChunksTable.$inferSelect;
