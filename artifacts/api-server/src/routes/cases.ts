import { Router, Request, Response } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  casesTable, clientsTable, pleadingsTable, hearingsTable, executionsTable, activityLogTable, caseDocumentsTable, usersTable, clientReportsTable, clientReportDeliveriesTable,
} from "@workspace/db";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { requireAuth } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import { sendPushToTenant } from "../lib/push";
import {
  sendMail,
  isMailerConfigured,
  isValidEmail,
  buildClientReportEmailHtml,
  MailAttachmentSizeLimitError,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "../lib/mailer";
import { generateClientReportPdf } from "../lib/client-report-pdf";
import { resolveOfficialSenderEmail } from "../lib/mail-settings";
import { extractReportDocumentIds } from "../lib/report-document-attachments";
import { serializeHearing } from "../lib/hearing-serialization";

const router = Router();
router.use(requireAuth);

type NewCaseClientInput = {
  name: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  address?: string;
  notes?: string;
  agencyNumber?: string;
  agencyEndDate?: string;
  agencySource?: "خدمات الموثقين" | "الخدمات الالكترونية";
};

// ─── Multer — PDF + images, 25 MB ────────────────────────────────────────────
const ALLOWED_DOC_MIMETYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
]);

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOC_MIMETYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("INVALID_TYPE"));
    }
  },
});

function uploadCaseDocMiddleware(req: Request, res: Response, next: (err?: unknown) => void) {
  docUpload.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "حجم الملف يتجاوز الحد المسموح (25 ميجابايت)." });
        return;
      }
      res.status(400).json({ error: "يُقبل ملفات PDF والصور فقط." });
      return;
    }
    next();
  });
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { clientId, status, outcome, search } = req.query as { clientId?: string; status?: string; outcome?: string; search?: string };

    const rows = await db
      .select({ case: casesTable, clientName: clientsTable.name })
      .from(casesTable)
      .leftJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
      .where(scoped(req, casesTable.tenantId));

    let results = rows;
    if (clientId) results = results.filter(r => r.case.clientId === parseInt(clientId, 10));
    if (status) results = results.filter(r => r.case.status === status);
    if (outcome) results = results.filter(r => r.case.outcome === outcome);
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(r =>
        r.case.caseNumber?.toLowerCase().includes(s) ||
        r.case.subject?.toLowerCase().includes(s) ||
        r.clientName?.toLowerCase().includes(s)
      );
    }

    res.json(results.map(({ case: c, clientName }) => ({
      ...c, clientName, createdAt: c.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "list cases error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { clientId, newClient, jurisdiction, clientRole, opponentName, subject, caseNumber, status, outcome } = req.body as {
      clientId?: number;
      newClient?: NewCaseClientInput;
      jurisdiction?: string; clientRole?: "PLAINTIFF" | "DEFENDANT"; opponentName?: string;
      subject?: string; caseNumber?: string; status?: string; outcome?: string;
    };
    const tenantId = tenantStamp(req);
    const hasNewClient = newClient !== undefined;
    if (hasNewClient && clientId !== undefined) {
      res.status(400).json({ error: "اختر عميلاً موجوداً أو أدخل بيانات عميل جديد، وليس كليهما." });
      return;
    }
    if (!hasNewClient && typeof clientId !== "number") {
      res.status(400).json({ error: "الرجاء اختيار العميل." });
      return;
    }
    if (hasNewClient && (!newClient || typeof newClient.name !== "string" || !newClient.name.trim())) {
      res.status(400).json({ error: "اسم العميل مطلوب." });
      return;
    }

    const newClientAgency = hasNewClient
      ? (() => {
          const body = newClient as unknown as Record<string, unknown>;
          const result: {
            agencyNumber: string | null;
            agencyEndDate: string | null;
            agencySource: "خدمات الموثقين" | "الخدمات الالكترونية" | null;
            error?: string;
          } = {
            agencyNumber: typeof body.agencyNumber === "string" && body.agencyNumber.trim()
              ? body.agencyNumber.trim()
              : null,
            agencyEndDate: body.agencyEndDate == null || body.agencyEndDate === ""
              ? null
              : typeof body.agencyEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.agencyEndDate)
                && !Number.isNaN(new Date(`${body.agencyEndDate}T00:00:00Z`).getTime())
                ? body.agencyEndDate
                : null,
            agencySource: body.agencySource == null || body.agencySource === ""
              ? null
              : body.agencySource === "خدمات الموثقين" || body.agencySource === "الخدمات الالكترونية"
                ? body.agencySource
                : null,
          };
          if (
            body.agencyEndDate != null
            && body.agencyEndDate !== ""
            && (
              typeof body.agencyEndDate !== "string"
              || !/^\d{4}-\d{2}-\d{2}$/.test(body.agencyEndDate)
              || Number.isNaN(new Date(`${body.agencyEndDate}T00:00:00Z`).getTime())
              || new Date(`${body.agencyEndDate}T00:00:00Z`).toISOString().slice(0, 10) !== body.agencyEndDate
            )
          ) {
            result.error = "تاريخ انتهاء الوكالة غير صالح.";
          } else if (
            body.agencySource != null
            && body.agencySource !== ""
            && body.agencySource !== "خدمات الموثقين"
            && body.agencySource !== "الخدمات الالكترونية"
          ) {
            result.error = "مصدر الوكالة غير صالح.";
          }
          return result;
        })()
      : null;
    if (newClientAgency?.error) {
      res.status(400).json({ error: newClientAgency.error });
      return;
    }

    // The new client, its audit log, the case, and the case audit log must
    // succeed or fail together. This prevents a failed case insert from
    // leaving the newly entered client without a case.
    const newCase = await db.transaction(async (tx) => {
      let finalClientId = clientId as number;

      if (hasNewClient) {
        const clientData = newClient as NewCaseClientInput;
        const [createdClient] = await tx.insert(clientsTable).values({
          tenantId,
          name: clientData.name.trim(),
          email: clientData.email,
          phone: clientData.phone,
          nationalId: clientData.nationalId,
          address: clientData.address,
          notes: clientData.notes,
          agencyNumber: newClientAgency!.agencyNumber,
          agencyEndDate: newClientAgency!.agencyEndDate,
          agencySource: newClientAgency!.agencySource,
        }).returning();

        await tx.insert(activityLogTable).values({
          tenantId,
          type: "CLIENT_CREATED",
          description: `تم إنشاء موكل جديد: ${clientData.name.trim()}`,
          entityId: createdClient.id,
          entityType: "client",
        });
        finalClientId = createdClient.id;
      } else {
        // Ensure the referenced client belongs to the caller's firm
        // (no cross-tenant links).
        const [client] = await tx.select({ id: clientsTable.id }).from(clientsTable)
          .where(scoped(req, clientsTable.tenantId, eq(clientsTable.id, finalClientId))).limit(1);
        if (!client) {
          const error = new Error("العميل غير موجود.");
          Object.assign(error, { status: 400 });
          throw error;
        }
      }

      const [createdCase] = await tx.insert(casesTable).values({
        tenantId,
        clientId: finalClientId,
        jurisdiction,
        clientRole,
        opponentName,
        subject,
        caseNumber,
        status: (status as any) ?? "UNDER_REVIEW",
        outcome: status === "CLOSED" && (outcome === "WON" || outcome === "LOST") ? outcome : "PENDING",
      }).returning();

      await tx.insert(activityLogTable).values({
        tenantId,
        type: "CASE_CREATED",
        description: `تم إنشاء قضية جديدة${caseNumber ? `: ${caseNumber}` : ""}`,
        entityId: createdCase.id,
        entityType: "case",
      });

      return createdCase;
    });

    sendPushToTenant(tenantId, {
      title: "قضية جديدة",
      body: caseNumber ? `تم إنشاء قضية جديدة: ${caseNumber}` : "تم إنشاء قضية جديدة",
      url: `/cases/${newCase.id}`,
    }).catch(() => {});

    res.status(201).json({ ...newCase, createdAt: newCase.createdAt.toISOString() });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    logger.error({ err }, "create case error");
    res.status(500).json({ error: "تعذر حفظ القضية والعميل معًا. لم يتم حفظ أي بيانات، يرجى المحاولة مرة أخرى." });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const [row] = await db
      .select({ case: casesTable, clientName: clientsTable.name })
      .from(casesTable)
      .leftJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Case not found" }); return; }

    const [pleadings, rawHearings, rawExecutions] = await Promise.all([
      db.select().from(pleadingsTable).where(scoped(req, pleadingsTable.tenantId, eq(pleadingsTable.caseId, id))),
      db.select().from(hearingsTable).where(scoped(req, hearingsTable.tenantId, eq(hearingsTable.caseId, id))),
      db.select().from(executionsTable).where(scoped(req, executionsTable.tenantId, eq(executionsTable.caseId, id))),
    ]);

    res.json({
      ...row.case,
      clientName: row.clientName,
      createdAt: row.case.createdAt.toISOString(),
      pleadings: pleadings.map(p => ({ ...p, createdAt: p.createdAt.toISOString() })),
      hearings: rawHearings.map(serializeHearing),
      executions: rawExecutions.map(e => ({
        ...e,
        totalAmount: parseFloat(e.totalAmount),
        paidAmount: parseFloat(e.paidAmount),
        remainingAmount: parseFloat(e.remainingAmount),
        lastReminderDate: e.lastReminderDate ? e.lastReminderDate.toISOString() : null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "get case error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const { jurisdiction, clientRole, opponentName, subject, description, caseNumber, status, outcome } = req.body as {
      jurisdiction?: string; clientRole?: "PLAINTIFF" | "DEFENDANT"; opponentName?: string;
      subject?: string; description?: string; caseNumber?: string; status?: string; outcome?: string;
    };

    const [existing] = await db.select().from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id))).limit(1);
    if (!existing) { res.status(404).json({ error: "Case not found" }); return; }

    // The outcome only makes sense for closed cases: reset it to PENDING when
    // a case is (re)opened, and only accept WON/LOST when the case is closed.
    const effectiveStatus = status ?? existing.status;
    let effectiveOutcome: "WON" | "LOST" | "PENDING" | undefined;
    if (effectiveStatus !== "CLOSED") {
      effectiveOutcome = existing.outcome === "PENDING" ? undefined : "PENDING";
    } else if (outcome === "WON" || outcome === "LOST" || outcome === "PENDING") {
      effectiveOutcome = outcome;
    }

    const [updated] = await db.update(casesTable).set({
      ...(jurisdiction !== undefined && { jurisdiction }),
      ...(clientRole !== undefined && { clientRole }),
      ...(opponentName !== undefined && { opponentName }),
      ...(subject !== undefined && { subject }),
      ...(description !== undefined && { description }),
      ...(caseNumber !== undefined && { caseNumber }),
      ...(status && { status: status as any }),
      ...(effectiveOutcome !== undefined && { outcome: effectiveOutcome }),
    }).where(scoped(req, casesTable.tenantId, eq(casesTable.id, id))).returning();
    if (!updated) { res.status(404).json({ error: "Case not found" }); return; }

    // Auto-create an execution record when a PLAINTIFF case is moved to EXECUTION
    // status. Defendant cases (علينا) never auto-create an execution record.
    // We use the effective clientRole (post-update value takes priority).
    const effectiveClientRole = clientRole ?? existing.clientRole;
    if (effectiveStatus === "EXECUTION" && effectiveClientRole === "PLAINTIFF") {
      const [existingExecution] = await db.select({ id: executionsTable.id })
        .from(executionsTable)
        .where(scoped(req, executionsTable.tenantId, eq(executionsTable.caseId, id)))
        .limit(1);
      if (!existingExecution) {
        const tenantId = tenantStamp(req);
        await db.insert(executionsTable).values({
          tenantId,
          caseId: id,
          totalAmount: "0",
          paidAmount: "0",
          status: "ACTIVE",
        });
      }
    }

    // Send push when status changes
    if (status && status !== existing.status) {
      const statusLabels: Record<string, string> = {
        UNDER_REVIEW: "قيد المراجعة",
        APPEAL: "استئناف",
        EXECUTION: "تنفيذ",
        CLOSED: "مغلقة",
      };
      const tenantId = tenantStamp(req);
      sendPushToTenant(tenantId, {
        title: "تحديث حالة القضية",
        body: `تم تغيير حالة القضية${updated.caseNumber ? ` ${updated.caseNumber}` : ""} إلى: ${statusLabels[status] ?? status}`,
        url: `/cases/${id}`,
      }).catch(() => {});
    }

    res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "update case error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    // Only SYSTEM_MANAGER may soft-delete a case
    if (req.auth!.role !== "SYSTEM_MANAGER") {
      res.status(403).json({ error: "غير مصرح — هذا الإجراء متاح لمدير النظام فقط" });
      return;
    }
    const id = parseInt(req.params["id"] as string, 10);
    const [existing] = await db.select().from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id))).limit(1);
    if (!existing) { res.status(404).json({ error: "Case not found" }); return; }
    if (existing.deletedAt) { res.status(409).json({ error: "القضية محذوفة مسبقاً" }); return; }

    // Resolve deleter info
    const [actor] = await db.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.auth!.userId)).limit(1);
    const deletedByName = actor?.name ?? req.auth!.email;
    const deletedByRole = actor?.role ?? req.auth!.role;

    const [updated] = await db.update(casesTable)
      .set({ deletedAt: new Date(), deletedByName, deletedByRole })
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id)))
      .returning();

    const [row] = await db
      .select({ case: casesTable, clientName: clientsTable.name })
      .from(casesTable)
      .leftJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id)))
      .limit(1);

    const tenantId = tenantStamp(req);
    const caseLabel = existing.caseNumber ? ` ${existing.caseNumber}` : "";
    sendPushToTenant(tenantId, {
      title: "تم حذف قضية",
      body: `تم حذف القضية${caseLabel} بواسطة: ${deletedByName}`,
      url: `/cases`,
    }).catch(() => {});

    res.json({ ...row!.case, clientName: row!.clientName, createdAt: row!.case.createdAt.toISOString(), deletedAt: updated.deletedAt!.toISOString() });
  } catch (err) {
    logger.error({ err }, "delete case error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Restore (un-delete) a soft-deleted case ────────────────────────────────
router.post("/:id/restore", async (req: Request, res: Response) => {
  try {
    // Only SYSTEM_MANAGER may restore a deleted case
    if (req.auth!.role !== "SYSTEM_MANAGER") {
      res.status(403).json({ error: "غير مصرح — هذا الإجراء متاح لمدير النظام فقط" });
      return;
    }
    const id = parseInt(req.params["id"] as string, 10);
    const [existing] = await db.select().from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id))).limit(1);
    if (!existing) { res.status(404).json({ error: "Case not found" }); return; }
    if (!existing.deletedAt) { res.status(409).json({ error: "القضية غير محذوفة" }); return; }

    const [updated] = await db.update(casesTable)
      .set({ deletedAt: null, deletedByName: null, deletedByRole: null })
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id)))
      .returning();

    const [row] = await db
      .select({ case: casesTable, clientName: clientsTable.name })
      .from(casesTable)
      .leftJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, id)))
      .limit(1);

    // Resolve restorer info
    const [actor] = await db.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.auth!.userId)).limit(1);
    const restoredByName = actor?.name ?? req.auth!.email;

    const tenantId = tenantStamp(req);
    const caseLabel = existing.caseNumber ? ` ${existing.caseNumber}` : "";
    sendPushToTenant(tenantId, {
      title: "تم استعادة قضية",
      body: `تم استعادة القضية${caseLabel} بواسطة: ${restoredByName}`,
      url: `/cases/${id}`,
    }).catch(() => {});

    res.json({ ...row!.case, clientName: row!.clientName, createdAt: row!.case.createdAt.toISOString(), deletedAt: null });
  } catch (err) {
    logger.error({ err }, "restore case error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Case Documents ───────────────────────────────────────────────────────────

function formatDoc(d: typeof caseDocumentsTable.$inferSelect) {
  return {
    id: d.id,
    caseId: d.caseId,
    fileName: d.fileName,
    mimeType: d.mimeType,
    submittedToCourt: d.submittedToCourt,
    courtReplyType: d.courtReplyType ?? null,
    courtNotes: d.courtNotes ?? null,
    submittedByName: d.submittedByName ?? null,
    submittedByRole: d.submittedByRole ?? null,
    uploadedAt: d.uploadedAt.toISOString(),
    deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
    deletedByName: d.deletedByName ?? null,
    deletedByRole: d.deletedByRole ?? null,
  };
}

// GET /cases/:id/documents
router.get("/:id/documents", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const tenantId = tenantStamp(req);
    // Verify case belongs to tenant
    const [c] = await db.select({ id: casesTable.id }).from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, caseId))).limit(1);
    if (!c) { res.status(404).json({ error: "القضية غير موجودة." }); return; }
    const docs = await db.select().from(caseDocumentsTable)
      .where(and(eq(caseDocumentsTable.caseId, caseId), eq(caseDocumentsTable.tenantId, tenantId)))
      .orderBy(caseDocumentsTable.uploadedAt);
    res.json(docs.map(formatDoc));
  } catch (err) {
    logger.error({ err }, "list case documents error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /cases/:id/documents — upload PDF or image
router.post("/:id/documents", uploadCaseDocMiddleware, async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const tenantId = tenantStamp(req);
    if (!req.file) { res.status(400).json({ error: "لم يتم إرفاق ملف." }); return; }
    // Verify case belongs to tenant
    const [c] = await db.select({ id: casesTable.id }).from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, caseId))).limit(1);
    if (!c) { res.status(404).json({ error: "القضية غير موجودة." }); return; }
    const fileName = Buffer.from(req.file.originalname, "latin1").toString("utf-8");
    const fileData = req.file.buffer.toString("base64");
    const [doc] = await db.insert(caseDocumentsTable).values({
      caseId, tenantId, fileName, mimeType: req.file.mimetype, fileData, submittedToCourt: false,
    }).returning();
    res.status(201).json(formatDoc(doc!));
  } catch (err) {
    logger.error({ err }, "upload case document error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /cases/:id/documents/:docId — update court status, reply type, or notes
router.patch("/:id/documents/:docId", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const docId = parseInt(req.params["docId"] as string, 10);
    const tenantId = tenantStamp(req);
    const body = req.body as {
      submittedToCourt?: unknown;
      courtReplyType?: unknown;
      courtNotes?: unknown;
    };
    const hasSubmittedToCourt = Object.prototype.hasOwnProperty.call(body, "submittedToCourt");
    const hasCourtReplyType = Object.prototype.hasOwnProperty.call(body, "courtReplyType");
    const hasCourtNotes = Object.prototype.hasOwnProperty.call(body, "courtNotes");
    if (!hasSubmittedToCourt && !hasCourtReplyType && !hasCourtNotes) {
      res.status(400).json({ error: "يجب إرسال حالة الرفع أو نوع الرد أو الملاحظات." });
      return;
    }
    if (hasSubmittedToCourt && typeof body.submittedToCourt !== "boolean") {
      res.status(400).json({ error: "القيمة المطلوبة: submittedToCourt (boolean)." });
      return;
    }
    if (hasCourtReplyType && body.courtReplyType !== null && body.courtReplyType !== "PLAINTIFF" && body.courtReplyType !== "DEFENDANT") {
      res.status(400).json({ error: "نوع الرد يجب أن يكون PLAINTIFF أو DEFENDANT أو null." });
      return;
    }
    if (hasCourtNotes && body.courtNotes !== null && typeof body.courtNotes !== "string") {
      res.status(400).json({ error: "الملاحظات يجب أن تكون نصًا أو null." });
      return;
    }
    const [doc] = await db.select().from(caseDocumentsTable)
      .where(and(eq(caseDocumentsTable.id, docId), eq(caseDocumentsTable.caseId, caseId), eq(caseDocumentsTable.tenantId, tenantId))).limit(1);
    if (!doc) { res.status(404).json({ error: "المستند غير موجود." }); return; }

    const nextSubmittedToCourt = hasSubmittedToCourt
      ? body.submittedToCourt as boolean
      : doc.submittedToCourt;
    const storedCourtReplyType = doc.courtReplyType === "PLAINTIFF" || doc.courtReplyType === "DEFENDANT"
      ? doc.courtReplyType
      : null;
    const nextCourtReplyType = !nextSubmittedToCourt
      ? null
      : hasCourtReplyType
        ? body.courtReplyType as "PLAINTIFF" | "DEFENDANT" | null
        : storedCourtReplyType;
    if (nextCourtReplyType !== null && !nextSubmittedToCourt) {
      res.status(400).json({ error: "لا يمكن تحديد نوع الرد قبل تفعيل حالة رفع المستند للمحكمة." });
      return;
    }
    if (hasCourtNotes && body.courtNotes !== null && body.courtNotes !== "" && nextCourtReplyType === null) {
      res.status(400).json({ error: "حدد رد المدعي أو رد المدعى عليه قبل حفظ الملاحظات." });
      return;
    }

    // Resolve submitter name from users table
    let submittedByName: string | null = doc.submittedByName;
    let submittedByRole: string | null = doc.submittedByRole;
    if (nextSubmittedToCourt && !doc.submittedToCourt) {
      const [user] = await db.select({ name: usersTable.name, role: usersTable.role })
        .from(usersTable).where(eq(usersTable.id, req.auth!.userId)).limit(1);
      submittedByName = user?.name ?? req.auth!.email;
      submittedByRole = user?.role ?? req.auth!.role;
    }

    const updateData: {
      submittedToCourt?: boolean;
      courtReplyType?: "PLAINTIFF" | "DEFENDANT" | null;
      courtNotes?: string | null;
      submittedByName?: string | null;
      submittedByRole?: string | null;
    } = {};
    if (hasSubmittedToCourt) updateData.submittedToCourt = body.submittedToCourt as boolean;
    if (hasCourtReplyType) updateData.courtReplyType = nextCourtReplyType;
    if (hasCourtNotes) updateData.courtNotes = body.courtNotes as string | null;
    if (!nextSubmittedToCourt) {
      updateData.courtReplyType = null;
      updateData.courtNotes = null;
      updateData.submittedByName = null;
      updateData.submittedByRole = null;
    } else if (hasCourtReplyType && body.courtReplyType === null) {
      updateData.courtNotes = null;
    }
    if (hasSubmittedToCourt) {
      updateData.submittedByName = nextSubmittedToCourt ? submittedByName : null;
      updateData.submittedByRole = nextSubmittedToCourt ? submittedByRole : null;
    }

    const [updated] = await db.update(caseDocumentsTable)
      .set(updateData)
      .where(scoped(
        req,
        caseDocumentsTable.tenantId,
        eq(caseDocumentsTable.id, docId),
        eq(caseDocumentsTable.caseId, caseId),
      )).returning();
    if (!updated) { res.status(404).json({ error: "المستند غير موجود." }); return; }
    res.json(formatDoc(updated!));
  } catch (err) {
    logger.error({ err }, "update case document error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /cases/:id/documents/:docId — soft delete (records who deleted it)
router.delete("/:id/documents/:docId", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const docId = parseInt(req.params["docId"] as string, 10);
    const tenantId = tenantStamp(req);
    const [doc] = await db.select({ id: caseDocumentsTable.id, deletedAt: caseDocumentsTable.deletedAt })
      .from(caseDocumentsTable)
      .where(and(eq(caseDocumentsTable.id, docId), eq(caseDocumentsTable.caseId, caseId), eq(caseDocumentsTable.tenantId, tenantId))).limit(1);
    if (!doc) { res.status(404).json({ error: "المستند غير موجود." }); return; }
    if (doc.deletedAt) { res.status(409).json({ error: "المستند محذوف مسبقاً." }); return; }

    // Resolve deleter name & role
    const [actor] = await db.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.auth!.userId)).limit(1);
    const deletedByName = actor?.name ?? req.auth!.email;
    const deletedByRole = actor?.role ?? req.auth!.role;

    const [updated] = await db.update(caseDocumentsTable)
      .set({ deletedAt: new Date(), deletedByName, deletedByRole })
      .where(eq(caseDocumentsTable.id, docId))
      .returning();
    res.json(formatDoc(updated!));
  } catch (err) {
    logger.error({ err }, "delete case document error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /cases/:id/documents/:docId/file — download raw PDF
router.get("/:id/documents/:docId/file", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const docId = parseInt(req.params["docId"] as string, 10);
    const tenantId = tenantStamp(req);
    const [doc] = await db.select().from(caseDocumentsTable)
      .where(and(eq(caseDocumentsTable.id, docId), eq(caseDocumentsTable.caseId, caseId), eq(caseDocumentsTable.tenantId, tenantId))).limit(1);
    if (!doc) { res.status(404).json({ error: "المستند غير موجود." }); return; }
    const buffer = Buffer.from(doc.fileData, "base64");
    const safeName = encodeURIComponent(doc.fileName);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeName}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    logger.error({ err }, "download case document error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Client Reports ───────────────────────────────────────────────────────────

// GET /cases/:id/report-template — assemble case data into ready-made blocks
router.get("/:id/report-template", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const tenantId = tenantStamp(req);

    // Verify ownership
    const [row] = await db
      .select({ case: casesTable, clientName: clientsTable.name })
      .from(casesTable)
      .leftJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
      .where(and(eq(casesTable.id, caseId), eq(casesTable.tenantId, tenantId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "القضية غير موجودة." }); return; }

    const [hearings, executions, documents] = await Promise.all([
      db.select().from(hearingsTable)
        .where(and(eq(hearingsTable.caseId, caseId), eq(hearingsTable.tenantId, tenantId))),
      db.select().from(executionsTable)
        .where(and(eq(executionsTable.caseId, caseId), eq(executionsTable.tenantId, tenantId))),
      db.select({
        id: caseDocumentsTable.id,
        fileName: caseDocumentsTable.fileName,
        mimeType: caseDocumentsTable.mimeType,
        uploadedAt: caseDocumentsTable.uploadedAt,
        deletedAt: caseDocumentsTable.deletedAt,
      }).from(caseDocumentsTable)
        .where(and(eq(caseDocumentsTable.caseId, caseId), eq(caseDocumentsTable.tenantId, tenantId))),
    ]);

    const now = new Date();
    const pastHearings = hearings.filter(h => h.utcDate < now);
    const upcomingHearings = hearings.filter(h => h.utcDate >= now);
    const activeDocs = documents.filter(d => !d.deletedAt);

    function genId() { return Math.random().toString(36).slice(2, 10); }

    const blocks: object[] = [];

    // Block 1: Case overview
    blocks.push({
      id: genId(),
      type: "text",
      title: "موضوع القضية",
      content: [
        `الجهة القضائية: ${row.case.jurisdiction || "غير محدد"}`,
        `رقم القضية: ${row.case.caseNumber || "غير محدد"}`,
        `الموكل: ${row.clientName || ""}`,
        `الخصم: ${row.case.opponentName || "غير محدد"}`,
        row.case.subject ? `\nموضوع القضية:\n${row.case.subject}` : "",
        row.case.description ? `\nتفاصيل إضافية:\n${row.case.description}` : "",
      ].filter(Boolean).join("\n"),
    });

    // Block 2: Past hearings
    if (pastHearings.length > 0) {
      blocks.push({
        id: genId(),
        type: "text",
        title: "الجلسات السابقة",
        content: pastHearings
          .sort((a, b) => a.utcDate.getTime() - b.utcDate.getTime())
          .map(h => {
            const parts = [`• ${h.hijriDate}`];
            if (h.attendance) parts.push(`الحضور: ${h.attendance}`);
            if (h.hearingReport) parts.push(`ما تم: ${h.hearingReport}`);
            return parts.join(" — ");
          })
          .join("\n"),
      });
    }

    // Block 3: Upcoming hearings
    if (upcomingHearings.length > 0) {
      blocks.push({
        id: genId(),
        type: "text",
        title: "الجلسات القادمة",
        content: upcomingHearings
          .sort((a, b) => a.utcDate.getTime() - b.utcDate.getTime())
          .map(h => `• ${h.hijriDate}${h.sessionLink ? ` — رابط: ${h.sessionLink}` : ""}`)
          .join("\n"),
      });
    }

    // Block 4: Executions
    if (executions.length > 0) {
      blocks.push({
        id: genId(),
        type: "text",
        title: "طلبات التنفيذ",
        content: executions
          .map(e => {
            const parts = [`رقم التنفيذ: ${e.executionNumber || "غير محدد"}`];
            if (e.type) parts.push(`النوع: ${e.type}`);
            parts.push(`الإجمالي: ${Number(e.totalAmount).toLocaleString("ar-SA")} ر.س`);
            parts.push(`المحصّل: ${Number(e.paidAmount).toLocaleString("ar-SA")} ر.س`);
            parts.push(`المتبقي: ${Number(e.remainingAmount).toLocaleString("ar-SA")} ر.س`);
            return "• " + parts.join(" | ");
          })
          .join("\n"),
      });
    }

    // Block 5: Documents as clickable links
    if (activeDocs.length > 0) {
      blocks.push({
        id: genId(),
        type: "links",
        title: "مستندات القضية",
        items: activeDocs.map(d => ({
          label: d.fileName,
          url: `/api/cases/${caseId}/documents/${d.id}/file`,
          extra: new Date(d.uploadedAt).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" }),
        })),
      });
    }

    res.json({ blocks });
  } catch (err) {
    logger.error({ err }, "report-template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /cases/:id/reports — list saved reports (newest first)
router.get("/:id/reports", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const tenantId = tenantStamp(req);
    const [c] = await db.select({ id: casesTable.id }).from(casesTable)
      .where(and(eq(casesTable.id, caseId), eq(casesTable.tenantId, tenantId))).limit(1);
    if (!c) { res.status(404).json({ error: "القضية غير موجودة." }); return; }

    const reports = await db.select().from(clientReportsTable)
      .where(and(eq(clientReportsTable.caseId, caseId), eq(clientReportsTable.tenantId, tenantId)))
      .orderBy(desc(clientReportsTable.createdAt));

    res.json(reports.map(r => ({
      id: r.id,
      title: r.title,
      reportData: r.reportData,
      createdAt: r.createdAt.toISOString(),
      lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
      lastSentTo: r.lastSentTo ?? null,
      lastSentBy: r.lastSentBy ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "list reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Block validation helpers ──────────────────────────────────────────────────

const ALLOWED_BLOCK_TYPES = new Set(["heading", "text", "links", "custom"]);
const MAX_FIELD_LEN = 10_000;
const MAX_TITLE_LEN = 500;
const MAX_BLOCKS = 100;
const MAX_ITEMS = 200;

function isValidUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const t = url.trim();
  if (t.startsWith("/api/")) return true;
  try {
    const p = new URL(t);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch { return false; }
}

function validateReportBlocks(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return "reportData يجب أن يكون مصفوفة.";
  if (blocks.length > MAX_BLOCKS) return `الحد الأقصى ${MAX_BLOCKS} قسماً.`;
  for (const b of blocks) {
    if (typeof b !== "object" || b === null) return "كل قسم يجب أن يكون كائناً.";
    const block = b as Record<string, unknown>;
    if (typeof block.id !== "string" || block.id.length > 64) return "معرّف القسم غير صالح.";
    if (!ALLOWED_BLOCK_TYPES.has(block.type as string)) return `نوع القسم غير مسموح: ${block.type}`;
    if (typeof block.title !== "string" || block.title.length > MAX_TITLE_LEN) return "عنوان القسم طويل جداً أو غير صالح.";
    if (block.content !== undefined && (typeof block.content !== "string" || block.content.length > MAX_FIELD_LEN)) return "محتوى القسم طويل جداً.";
    if (block.items !== undefined) {
      if (!Array.isArray(block.items) || block.items.length > MAX_ITEMS) return "عدد العناصر تجاوز الحد.";
      for (const item of block.items) {
        if (typeof item !== "object" || item === null) return "عنصر غير صالح في القسم.";
        const it = item as Record<string, unknown>;
        if (typeof it.label !== "string" || it.label.length > MAX_TITLE_LEN) return "تسمية العنصر غير صالحة.";
        if (it.url !== undefined && !isValidUrl(it.url)) return "رابط غير مسموح في المستندات.";
        if (it.extra !== undefined && (typeof it.extra !== "string" || it.extra.length > MAX_TITLE_LEN)) return "حقل extra غير صالح.";
      }
    }
  }
  return null;
}

// POST /cases/:id/reports — save a new report
router.post("/:id/reports", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const tenantId = tenantStamp(req);
    const { title, reportData } = req.body as { title?: string; reportData?: unknown };

    const [c] = await db.select({ id: casesTable.id }).from(casesTable)
      .where(and(eq(casesTable.id, caseId), eq(casesTable.tenantId, tenantId))).limit(1);
    if (!c) { res.status(404).json({ error: "القضية غير موجودة." }); return; }

    const validationError = validateReportBlocks(reportData);
    if (validationError) { res.status(400).json({ error: validationError }); return; }

    const trimmedTitle = (title ?? "").trim().slice(0, MAX_TITLE_LEN) || "تقرير العميل";

    const [report] = await db.insert(clientReportsTable).values({
      tenantId,
      caseId,
      title: trimmedTitle,
      reportData: reportData as any,
    }).returning();

    res.status(201).json({ id: report!.id, title: report!.title, reportData: report!.reportData, createdAt: report!.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "save report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /cases/:id/send-report — send report HTML to client's email
router.post("/:id/send-report", async (req: Request, res: Response) => {
  let providerAccepted = false;
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const tenantId = tenantStamp(req);
    const { title, reportData, reportId, sendAttemptId } = req.body as {
      title?: string;
      reportData?: unknown;
      reportId?: unknown;
      sendAttemptId?: unknown;
    };

    // Verify case & get client email
    const [row] = await db
      .select({
        caseNumber: casesTable.caseNumber,
        clientName: clientsTable.name,
        clientEmail: clientsTable.email,
      })
      .from(casesTable)
      .leftJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
      .where(and(eq(casesTable.id, caseId), eq(casesTable.tenantId, tenantId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "القضية غير موجودة." }); return; }

    const validationError = validateReportBlocks(reportData);
    if (validationError) { res.status(400).json({ error: validationError }); return; }

    if (
      reportId !== undefined &&
      (typeof reportId !== "number" || !Number.isInteger(reportId) || reportId <= 0)
    ) {
      res.status(400).json({ error: "معرّف التقرير غير صالح." });
      return;
    }
    if (
      typeof sendAttemptId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sendAttemptId)
    ) {
      res.status(400).json({ error: "معرّف محاولة الإرسال غير صالح." });
      return;
    }

    const trimmedTitle = (title ?? "").trim().slice(0, MAX_TITLE_LEN) || "تقرير العميل";
    const reportBlocks = reportData as import("../lib/mailer").ReportBlock[];
    const requestedReportId = reportId as number | undefined;

    const [existingDelivery] = await db
      .select()
      .from(clientReportDeliveriesTable)
      .where(and(
        eq(clientReportDeliveriesTable.attemptId, sendAttemptId),
        eq(clientReportDeliveriesTable.tenantId, tenantId),
      ))
      .limit(1);

    if (
      existingDelivery &&
      (
        existingDelivery.caseId !== caseId ||
        existingDelivery.initiatedByUserId !== req.auth!.userId ||
        existingDelivery.requestedReportId !== (requestedReportId ?? null) ||
        existingDelivery.title !== trimmedTitle ||
        !isDeepStrictEqual(existingDelivery.reportData, reportBlocks)
      )
    ) {
      res.status(409).json({
        error: "معرّف محاولة الإرسال مستخدم لنسخة مختلفة من التقرير. أعد الإرسال كمحاولة جديدة.",
        code: "REPORT_SEND_ATTEMPT_CONFLICT",
      });
      return;
    }

    let delivery = existingDelivery;
    let senderEmail: string | null | undefined;
    if (!delivery) {
      if (!row.clientEmail || !isValidEmail(row.clientEmail)) {
        res.status(422).json({ error: "لا يوجد بريد إلكتروني مسجّل للعميل. يرجى إضافة بريده أولاً من صفحة العملاء." });
        return;
      }
      if (!isMailerConfigured()) {
        res.status(503).json({ error: "خدمة البريد الإلكتروني غير مفعّلة (RESEND_API_KEY مفقود)." });
        return;
      }
      senderEmail = await resolveOfficialSenderEmail(tenantId);
      if (!senderEmail) {
        res.status(503).json({ error: "لم يتم تحديد البريد الرسمي للمرسل. يرجى إضافته من صفحة الإعدادات." });
        return;
      }
      if (requestedReportId !== undefined) {
        const [existingReport] = await db.select({ id: clientReportsTable.id })
          .from(clientReportsTable)
          .where(and(
            eq(clientReportsTable.id, requestedReportId),
            eq(clientReportsTable.caseId, caseId),
            eq(clientReportsTable.tenantId, tenantId),
          ))
          .limit(1);
        if (!existingReport) { res.status(404).json({ error: "التقرير غير موجود." }); return; }
      }

      const [sender] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(scoped(req, usersTable.tenantId, eq(usersTable.id, req.auth!.userId)))
        .limit(1);
      const sentBy = sender?.name?.trim() || req.auth!.email;

      [delivery] = await db
        .insert(clientReportDeliveriesTable)
        .values({
          attemptId: sendAttemptId,
          tenantId,
          caseId,
          initiatedByUserId: req.auth!.userId,
          requestedReportId: requestedReportId ?? null,
          title: trimmedTitle,
          reportData: reportData as any,
          senderEmail,
          recipient: row.clientEmail,
          sentBy,
        })
        .returning();
    }

    if (delivery.savedReportId !== null) {
      const [savedReport] = await db
        .select()
        .from(clientReportsTable)
        .where(and(
          eq(clientReportsTable.id, delivery.savedReportId),
          eq(clientReportsTable.caseId, caseId),
          eq(clientReportsTable.tenantId, tenantId),
        ))
        .limit(1);
      if (savedReport?.lastSentAt) {
        res.json({
          ok: true,
          reportId: savedReport.id,
          sentTo: delivery.recipient,
          sentAt: savedReport.lastSentAt.toISOString(),
          sentBy: delivery.sentBy,
        });
        return;
      }
    }

    if (!delivery.providerAcceptedAt) {
      const documentIds = extractReportDocumentIds(reportBlocks, caseId);
      const reportDocuments = documentIds.length
        ? await db.select({
            id: caseDocumentsTable.id,
            fileName: caseDocumentsTable.fileName,
            fileData: caseDocumentsTable.fileData,
          }).from(caseDocumentsTable).where(and(
            eq(caseDocumentsTable.caseId, caseId),
            eq(caseDocumentsTable.tenantId, tenantId),
            isNull(caseDocumentsTable.deletedAt),
            inArray(caseDocumentsTable.id, documentIds),
          ))
        : [];
      const documentsById = new Map(reportDocuments.map(document => [document.id, document]));
      const orderedDocuments = documentIds.flatMap(id => {
        const document = documentsById.get(id);
        return document ? [document] : [];
      });
      if (orderedDocuments.length !== documentIds.length) {
        res.status(409).json({
          error: "تعذر إرسال التقرير لأن أحد مستندات القضية التي اخترتها لم يعد متاحاً. حدّث التقرير ثم أعد المحاولة.",
          code: "REPORT_DOCUMENTS_CHANGED",
        });
        return;
      }

      const pdf = await generateClientReportPdf({
        clientName: row.clientName ?? "العميل الكريم",
        reportTitle: trimmedTitle,
        caseNumber: row.caseNumber,
        blocks: reportBlocks,
      });
      const html = buildClientReportEmailHtml({
        clientName: row.clientName ?? "العميل الكريم",
        reportTitle: trimmedTitle,
        caseNumber: row.caseNumber,
        documentNames: orderedDocuments.map(document => document.fileName),
      });

      const receipt = await sendMail({
        from: delivery.senderEmail,
        to: delivery.recipient,
        subject: `${trimmedTitle}${row.caseNumber ? ` — القضية ${row.caseNumber}` : ""} | مكتب المحامي ماجد بن سلطان السبيعي`,
        html,
        attachments: [
          { filename: `client-report-case-${caseId}.pdf`, content: pdf },
          ...orderedDocuments.map(document => ({
            filename: document.fileName,
            content: Buffer.from(document.fileData, "base64"),
          })),
        ],
        idempotencyKey: `client-report:${tenantId}:${sendAttemptId}`,
      });
      providerAccepted = true;

      const acceptedAt = new Date();
      [delivery] = await db
        .update(clientReportDeliveriesTable)
        .set({
          providerMessageId: receipt.id,
          providerAcceptedAt: acceptedAt,
        })
        .where(and(
          eq(clientReportDeliveriesTable.attemptId, sendAttemptId),
          eq(clientReportDeliveriesTable.tenantId, tenantId),
        ))
        .returning();
      if (!delivery) {
        throw new Error("Delivery attempt disappeared after provider acceptance");
      }
    } else {
      providerAccepted = true;
    }

    const sentAt = delivery.providerAcceptedAt!;
    const sentBy = delivery.sentBy;

    // Sending a report is also a durable report event. Update the saved report
    // that was opened, or create one when the user sent a new unsaved report.
    const sentReportValues = {
      tenantId,
      caseId,
      title: trimmedTitle,
      reportData: reportData as any,
      lastSentAt: sentAt,
      lastSentTo: delivery.recipient,
      lastSentBy: sentBy,
    };
    const savedReport = await db.transaction(async (tx) => {
      let persistedReport: typeof clientReportsTable.$inferSelect | undefined;

      if (requestedReportId !== undefined) {
        [persistedReport] = await tx.update(clientReportsTable)
          .set(sentReportValues)
          .where(and(
            eq(clientReportsTable.id, requestedReportId),
            eq(clientReportsTable.caseId, caseId),
            eq(clientReportsTable.tenantId, tenantId),
          ))
          .returning();
      }

      // The report can be deleted in another session while the email is being
      // delivered. Preserve the successful send as a new saved report in that case.
      if (!persistedReport) {
        [persistedReport] = await tx.insert(clientReportsTable)
          .values(sentReportValues)
          .returning();
      }

      await tx
        .update(clientReportDeliveriesTable)
        .set({ savedReportId: persistedReport!.id })
        .where(and(
          eq(clientReportDeliveriesTable.attemptId, sendAttemptId),
          eq(clientReportDeliveriesTable.tenantId, tenantId),
        ));

      return persistedReport;
    });

    logger.info(
      {
        caseId,
        reportId: savedReport!.id,
        sendAttemptId,
        providerMessageId: delivery.providerMessageId,
        to: delivery.recipient,
        sentBy,
      },
      "client report email sent",
    );
    res.json({
      ok: true,
      reportId: savedReport!.id,
      sentTo: delivery.recipient,
      sentAt: savedReport!.lastSentAt!.toISOString(),
      sentBy,
    });
  } catch (err: any) {
    logger.error({ err }, "send report email error");
    if (providerAccepted) {
      res.status(503).json({
        error: "قبل مزود البريد الرسالة، لكن تعذر إكمال حفظ النتيجة. أعد المحاولة لاستكمال العملية دون إرسال نسخة إضافية.",
        code: "REPORT_DELIVERY_FINALIZATION_FAILED",
      });
      return;
    }
    let msg = "فشل إرسال البريد الإلكتروني. يرجى المحاولة لاحقاً.";
    if (err instanceof MailAttachmentSizeLimitError || err?.resendName === "attachment_size_limit") {
      const totalBytes = Number(err?.totalBytes);
      const totalMegabytes = Number.isFinite(totalBytes)
        ? (totalBytes / (1024 * 1024)).toFixed(1)
        : "المحسوب";
      const maxMegabytes = (MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0);
      msg = `إجمالي حجم مرفقات التقرير (${totalMegabytes} ميجابايت) يتجاوز حد مزود البريد (${maxMegabytes} ميجابايت). لم تُرسل الرسالة. أزل بعض مستندات القضية أو أرسلها بوسيلة أخرى ثم أعد المحاولة.`;
      res.status(413).json({
        error: msg,
        code: "MAIL_ATTACHMENT_SIZE_LIMIT",
        ...(Number.isFinite(totalBytes) ? { totalBytes } : {}),
        maxBytes: MAX_TOTAL_ATTACHMENT_BYTES,
      });
      return;
    } else if (err?.resendName === "missing_from_address") {
      msg = "لم يتم تحديد البريد الرسمي للمرسل. يرجى إضافته من صفحة الإعدادات.";
    } else if (err?.resendName === "validation_error" || err?.resendName === "invalid_from_address") {
      msg = "رفض مزود البريد عنوان المرسل. تحقق من أنه مسجل من صفحة الإعدادات وأن نطاقه موثق في Resend.";
    }
    res.status(500).json({ error: msg });
  }
});

// DELETE /cases/:id/reports/:reportId
router.delete("/:id/reports/:reportId", async (req: Request, res: Response) => {
  try {
    const caseId = parseInt(req.params["id"] as string, 10);
    const reportId = parseInt(req.params["reportId"] as string, 10);
    const tenantId = tenantStamp(req);

    const [deletedReport] = await db.delete(clientReportsTable)
      .where(and(
        eq(clientReportsTable.id, reportId),
        eq(clientReportsTable.caseId, caseId),
        eq(clientReportsTable.tenantId, tenantId),
      ))
      .returning({ id: clientReportsTable.id });
    if (!deletedReport) { res.status(404).json({ error: "التقرير غير موجود." }); return; }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
