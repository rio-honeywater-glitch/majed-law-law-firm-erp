import { Router, type IRouter, Request, Response } from "express";
import multer from "multer";
import OpenAI from "openai";
import { db, legalDocumentsTable, legalChunksTable, activityLogTable, chatConversationsTable, chatMessagesTable } from "@workspace/db";
import { eq, sql, count, isNotNull, isNull, and, or, gte, lte, desc } from "drizzle-orm";
import { requireAuth, requireSystemManager } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import { AskLegalAssistantBody } from "@workspace/api-zod";
import { extractPdfText, chunkText, decodeUtf8Text, formatSourceText } from "../lib/arabic-text";

const router: IRouter = Router();
router.use(requireAuth);

const AI_UNCONFIGURED_MSG =
  "خدمة الذكاء الاصطناعي غير مهيأة. يرجى إضافة مفتاح OPENAI_API_KEY في إعدادات النظام.";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

// multer — memory storage, PDF or plain text, 25 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.mimetype === "text/plain" ||
      file.originalname.toLowerCase().endsWith(".txt");
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF or TXT files are accepted"));
    }
  },
});

// ─── Embeddings ──────────────────────────────────────────────────────────────

async function embedTexts(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const BATCH = 100;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });
    for (const item of res.data) out.push(item.embedding);
  }
  return out;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Normalizes multer errors (size limit / bad file type) into Arabic JSON responses
function uploadSingleFile(req: Request, res: Response, next: (err?: unknown) => void) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "حجم الملف يتجاوز الحد المسموح (25 ميجابايت)." });
        return;
      }
      res.status(400).json({ error: "نوع الملف غير مدعوم. يرجى رفع ملف PDF أو TXT فقط." });
      return;
    }
    next();
  });
}

const MAX_CHUNKS_PER_DOCUMENT = 1000;

// POST /ai/upload — SYSTEM_MANAGER only
router.post("/upload", requireSystemManager, uploadSingleFile, async (req: Request, res: Response) => {
  try {
    const openai = getOpenAI();
    if (!openai) {
      res.status(503).json({ error: AI_UNCONFIGURED_MSG });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "لم يتم إرفاق ملف. يرجى رفع ملف PDF أو نصي." });
      return;
    }

    const isTxt =
      req.file.mimetype === "text/plain" || req.file.originalname.toLowerCase().endsWith(".txt");

    let text = "";
    if (isTxt) {
      // TXT fallback: strict UTF-8 decoding, bypasses PDF extraction entirely
      try {
        text = decodeUtf8Text(req.file.buffer);
      } catch {
        res.status(400).json({
          error: "الملف النصي ليس بترميز UTF-8 صالح. يرجى حفظ الملف بترميز UTF-8 وإعادة رفعه.",
        });
        return;
      }
    } else {
      // Position-aware RTL extraction; BiDi correction happens inside chunkText
      text = await extractPdfText(req.file.buffer);
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      res.status(400).json({ error: "تعذر استخراج نص من الملف. تأكد من أن الملف يحتوي على نص قابل للقراءة." });
      return;
    }
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      res.status(400).json({
        error: `المستند كبير جداً (${chunks.length} مقطع). الحد الأقصى ${MAX_CHUNKS_PER_DOCUMENT} مقطع — يرجى تقسيم الملف.`,
      });
      return;
    }

    const rawTitle = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const title = rawTitle || Buffer.from(req.file.originalname, "latin1").toString("utf-8");

    const embeddings = await embedTexts(openai, chunks);
    const tenantId = tenantStamp(req);

    const created = await db.transaction(async (tx) => {
      const [doc] = await tx.insert(legalDocumentsTable).values({ tenantId, title }).returning();
      const rows = chunks.map((content, i) => ({
        tenantId,
        documentId: doc!.id,
        chunkIndex: i,
        content,
        embedding: embeddings[i]!,
      }));
      const INSERT_BATCH = 200;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await tx.insert(legalChunksTable).values(rows.slice(i, i + INSERT_BATCH));
      }
      return doc!;
    });

    await db.insert(activityLogTable).values({
      tenantId,
      type: "LEGAL_DOC_UPLOADED",
      description: `تم فهرسة مستند قانوني: ${title} (${chunks.length} مقطع)`,
      entityId: 0,
      entityType: "LEGAL_DOCUMENT",
    });

    req.log.info({ documentId: created.id, chunks: chunks.length }, "legal document indexed");
    res.status(201).json({
      id: created.id,
      title: created.title,
      uploadedAt: created.uploadedAt.toISOString(),
      chunkCount: chunks.length,
    });
  } catch (err) {
    logger.error({ err }, "legal document upload error");
    res.status(500).json({ error: "حدث خطأ أثناء معالجة المستند." });
  }
});

// POST /ai/ask — open to all authenticated users
router.post("/ask", async (req: Request, res: Response) => {
  try {
    const openai = getOpenAI();
    if (!openai) {
      res.status(503).json({ error: AI_UNCONFIGURED_MSG });
      return;
    }
    const parsed = AskLegalAssistantBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "يرجى إدخال سؤال صحيح." });
      return;
    }
    const prompt = parsed.data.prompt.trim();

    // Visible chunks = shared global laws (tenant_id IS NULL) + this firm's own docs.
    const myTenant = req.auth!.tenantId;
    const visibleChunks =
      myTenant == null
        ? isNotNull(legalChunksTable.embedding)
        : and(
            isNotNull(legalChunksTable.embedding),
            or(isNull(legalChunksTable.tenantId), eq(legalChunksTable.tenantId, myTenant)),
          );

    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(legalChunksTable)
      .where(visibleChunks);
    if (!total) {
      res.status(404).json({ error: "لا توجد مستندات قانونية مفهرسة بعد. يرجى رفع الأنظمة أولاً من قبل مدير النظام." });
      return;
    }

    const embRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: prompt,
    });
    const queryVec = embRes.data[0]!.embedding;
    const vecLiteral = JSON.stringify(queryVec);

    const topChunks = await db
      .select({
        id: legalChunksTable.id,
        content: legalChunksTable.content,
        documentTitle: legalDocumentsTable.title,
        distance: sql<number>`${legalChunksTable.embedding} <=> ${vecLiteral}::vector`,
      })
      .from(legalChunksTable)
      .innerJoin(legalDocumentsTable, eq(legalChunksTable.documentId, legalDocumentsTable.id))
      .where(visibleChunks)
      .orderBy(sql`${legalChunksTable.embedding} <=> ${vecLiteral}::vector`)
      .limit(5);

    const context = topChunks
      .map((c, i) => `[المقطع ${i + 1} — من "${c.documentTitle}"]\n${c.content}`)
      .join("\n\n---\n\n");

    const contextBlock = `=== بداية المستندات القانونية ===\n\n${context}\n\n=== نهاية المستندات القانونية ===`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1500,
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content:
            "You are an expert Saudi Legal Assistant. Your primary task is to answer the user's question using ONLY the provided context. Read the context carefully. If the provided context contains legal articles or concepts that address the core of the user's question, you MUST formulate a clear, professional answer based on them, even if the user's phrasing differs from the legal text. Synthesize the relevant articles into a coherent Arabic answer. Only reply that the documents do not cover the question if the context is completely and entirely irrelevant to the topic asked about. Always answer in Arabic.",
        },
        {
          role: "user",
          content: `${contextBlock}\n\nسؤال المستخدم: ${prompt}`,
        },
      ],
    });

    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
      res.status(500).json({ error: "لم يتمكن المساعد من توليد إجابة. حاول مرة أخرى." });
      return;
    }

    res.json({
      answer,
      sources: topChunks.map((c) => ({
        id: c.id,
        content: formatSourceText(c.content),
        documentTitle: c.documentTitle,
      })),
    });
  } catch (err) {
    logger.error({ err }, "ai ask error");
    res.status(500).json({ error: "حدث خطأ أثناء معالجة السؤال." });
  }
});

// GET /ai/documents — SYSTEM_MANAGER only
router.get("/documents", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: legalDocumentsTable.id,
        title: legalDocumentsTable.title,
        uploadedAt: legalDocumentsTable.uploadedAt,
        chunkCount: count(legalChunksTable.id),
      })
      .from(legalDocumentsTable)
      .leftJoin(legalChunksTable, eq(legalChunksTable.documentId, legalDocumentsTable.id))
      .where(scoped(req, legalDocumentsTable.tenantId))
      .groupBy(legalDocumentsTable.id)
      .orderBy(sql`${legalDocumentsTable.uploadedAt} DESC`);
    res.json(rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "list legal documents error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /ai/clear-index — SYSTEM_MANAGER only: purge ALL indexed documents.
// legal_chunks.document_id has ON DELETE CASCADE, so all vectors are purged too.
router.delete("/clear-index", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const [{ docCount } = { docCount: 0 }] = await db
      .select({ docCount: count() })
      .from(legalDocumentsTable)
      .where(scoped(req, legalDocumentsTable.tenantId));

    await db.delete(legalDocumentsTable).where(scoped(req, legalDocumentsTable.tenantId));

    await db.insert(activityLogTable).values({
      tenantId: tenantStamp(req),
      type: "LEGAL_INDEX_CLEARED",
      description: `تم مسح جميع الفهارس القانونية (${docCount} مستند)`,
      entityId: 0,
      entityType: "LEGAL_DOCUMENT",
    });

    req.log.info({ deletedDocuments: docCount }, "legal index cleared");
    res.json({ deletedDocuments: docCount });
  } catch (err) {
    logger.error({ err }, "clear legal index error");
    res.status(500).json({ error: "حدث خطأ أثناء مسح الفهارس." });
  }
});

// DELETE /ai/documents/:id — SYSTEM_MANAGER only
router.delete("/documents/:id", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const [doc] = await db.select().from(legalDocumentsTable)
      .where(scoped(req, legalDocumentsTable.tenantId, eq(legalDocumentsTable.id, id))).limit(1);
    if (!doc) {
      res.status(404).json({ error: "المستند غير موجود." });
      return;
    }
    await db.delete(legalDocumentsTable).where(scoped(req, legalDocumentsTable.tenantId, eq(legalDocumentsTable.id, id)));
    req.log.info({ documentId: id }, "legal document deleted");
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "delete legal document error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── CHAT CONVERSATIONS ───────────────────────────────────────────────────────

// GET /ai/conversations — list conversations (optionally filtered by dateFrom/dateTo)
router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const userId = req.auth!.userId;
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

    const conditions = [
      eq(chatConversationsTable.tenantId, tenantId),
      eq(chatConversationsTable.userId, userId),
    ];
    if (dateFrom) conditions.push(gte(chatConversationsTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(chatConversationsTable.createdAt, new Date(dateTo)));

    const rows = await db
      .select()
      .from(chatConversationsTable)
      .where(and(...conditions))
      .orderBy(desc(chatConversationsTable.createdAt));

    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "list conversations error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /ai/conversations — create a new conversation
router.post("/conversations", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const userId = req.auth!.userId;
    const { title } = req.body as { title?: string };
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      res.status(400).json({ error: "العنوان مطلوب." });
      return;
    }
    const [conv] = await db
      .insert(chatConversationsTable)
      .values({ tenantId, userId, title: title.trim().slice(0, 120) })
      .returning();
    res.status(201).json({ ...conv!, createdAt: conv!.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "create conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /ai/conversations/:id — rename title or toggle pin
router.patch("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const userId = req.auth!.userId;
    const id = Number(req.params["id"]);

    const [conv] = await db
      .select()
      .from(chatConversationsTable)
      .where(and(eq(chatConversationsTable.id, id), eq(chatConversationsTable.tenantId, tenantId), eq(chatConversationsTable.userId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة." }); return; }

    const updates: Partial<typeof chatConversationsTable.$inferInsert> = {};
    const { title, isPinned } = req.body as { title?: string; isPinned?: boolean };
    if (typeof title === "string" && title.trim().length > 0) updates.title = title.trim().slice(0, 120);
    if (typeof isPinned === "boolean") updates.isPinned = isPinned;

    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "لا توجد حقول للتحديث." }); return; }

    const [updated] = await db.update(chatConversationsTable).set(updates).where(eq(chatConversationsTable.id, id)).returning();
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "update conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /ai/conversations/:id
router.delete("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const userId = req.auth!.userId;
    const id = Number(req.params["id"]);
    const [conv] = await db
      .select()
      .from(chatConversationsTable)
      .where(and(eq(chatConversationsTable.id, id), eq(chatConversationsTable.tenantId, tenantId), eq(chatConversationsTable.userId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة." }); return; }
    await db.delete(chatConversationsTable).where(eq(chatConversationsTable.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "delete conversation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /ai/conversations/:id/messages
router.get("/conversations/:id/messages", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const userId = req.auth!.userId;
    const id = Number(req.params["id"]);
    const [conv] = await db
      .select()
      .from(chatConversationsTable)
      .where(and(eq(chatConversationsTable.id, id), eq(chatConversationsTable.tenantId, tenantId), eq(chatConversationsTable.userId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة." }); return; }
    const messages = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, id))
      .orderBy(chatMessagesTable.createdAt);
    res.json(messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "list messages error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /ai/conversations/:id/ask — ask within a conversation and persist both messages
router.post("/conversations/:id/ask", async (req: Request, res: Response) => {
  try {
    const openai = getOpenAI();
    if (!openai) { res.status(503).json({ error: AI_UNCONFIGURED_MSG }); return; }

    const tenantId = tenantStamp(req);
    const userId = req.auth!.userId;
    const id = Number(req.params["id"]);

    const [conv] = await db
      .select()
      .from(chatConversationsTable)
      .where(and(eq(chatConversationsTable.id, id), eq(chatConversationsTable.tenantId, tenantId), eq(chatConversationsTable.userId, userId)))
      .limit(1);
    if (!conv) { res.status(404).json({ error: "المحادثة غير موجودة." }); return; }

    const parsed = AskLegalAssistantBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "يرجى إدخال سؤال صحيح." }); return; }
    const prompt = parsed.data.prompt.trim();

    // Count existing messages — if this is the first one, auto-rename the conversation
    const [{ msgCount } = { msgCount: 0 }] = await db
      .select({ msgCount: count() })
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, id));

    // Auto-rename: take first 5 words of the prompt (strip punctuation, trim)
    if (msgCount === 0 && conv.title === "محادثة جديدة") {
      const autoTitle = prompt
        .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, " ")
        .trim()
        .split(/\s+/)
        .slice(0, 5)
        .join(" ")
        .slice(0, 120);
      if (autoTitle.length > 0) {
        await db.update(chatConversationsTable).set({ title: autoTitle }).where(eq(chatConversationsTable.id, id));
      }
    }

    // Save user message first
    await db.insert(chatMessagesTable).values({ conversationId: id, role: "user", content: prompt });

    // RAG: find relevant chunks
    const myTenant = req.auth!.tenantId;
    const visibleChunks =
      myTenant == null
        ? isNotNull(legalChunksTable.embedding)
        : and(isNotNull(legalChunksTable.embedding), or(isNull(legalChunksTable.tenantId), eq(legalChunksTable.tenantId, myTenant)));

    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(legalChunksTable).where(visibleChunks);

    let answer: string;
    let topChunks: Array<{ id: string; content: string; documentTitle: string }> = [];

    if (!total) {
      answer = "لا توجد مستندات قانونية مفهرسة بعد. يرجى رفع الأنظمة أولاً من قبل مدير النظام.";
    } else {
      const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: prompt });
      const queryVec = embRes.data[0]!.embedding;
      const vecLiteral = JSON.stringify(queryVec);

      const chunks = await db
        .select({
          id: legalChunksTable.id,
          content: legalChunksTable.content,
          documentTitle: legalDocumentsTable.title,
          distance: sql<number>`${legalChunksTable.embedding} <=> ${vecLiteral}::vector`,
        })
        .from(legalChunksTable)
        .innerJoin(legalDocumentsTable, eq(legalChunksTable.documentId, legalDocumentsTable.id))
        .where(visibleChunks)
        .orderBy(sql`${legalChunksTable.embedding} <=> ${vecLiteral}::vector`)
        .limit(5);

      const context = chunks.map((c, i) => `[المقطع ${i + 1} — من "${c.documentTitle}"]\n${c.content}`).join("\n\n---\n\n");

      const contextBlock = `=== بداية المستندات القانونية ===\n\n${context}\n\n=== نهاية المستندات القانونية ===`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1500,
        temperature: 0.25,
        messages: [
          {
            role: "system",
            content:
              "You are an expert Saudi Legal Assistant. Your primary task is to answer the user's question using ONLY the provided context. Read the context carefully. If the provided context contains legal articles or concepts that address the core of the user's question, you MUST formulate a clear, professional answer based on them, even if the user's phrasing differs from the legal text. Synthesize the relevant articles into a coherent Arabic answer. Only reply that the documents do not cover the question if the context is completely and entirely irrelevant to the topic asked about. Always answer in Arabic.",
          },
          { role: "user", content: `${contextBlock}\n\nسؤال المستخدم: ${prompt}` },
        ],
      });

      answer = completion.choices[0]?.message?.content?.trim() ?? "";
      if (!answer) { res.status(500).json({ error: "لم يتمكن المساعد من توليد إجابة. حاول مرة أخرى." }); return; }

      topChunks = chunks.map((c) => ({ id: c.id, content: formatSourceText(c.content), documentTitle: c.documentTitle }));
    }

    // Save assistant message
    await db.insert(chatMessagesTable).values({
      conversationId: id,
      role: "assistant",
      content: answer,
      sources: topChunks.length > 0 ? topChunks : null,
    });

    res.json({ answer, sources: topChunks });
  } catch (err) {
    logger.error({ err }, "ask in conversation error");
    res.status(500).json({ error: "حدث خطأ أثناء معالجة السؤال." });
  }
});

export default router;
