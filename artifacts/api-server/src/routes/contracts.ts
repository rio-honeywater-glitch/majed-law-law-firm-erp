import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { contractsTable, clientsTable, activityLogTable } from "@workspace/db";
import { eq, sql, gte, lte, and, max } from "drizzle-orm";
import { requireAuth, requireSystemManager } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import ExcelJS from "exceljs";
import { generateContractPdf, UPLOADS_DIR } from "../lib/contract-pdf";
import { sendMail, isMailerConfigured, buildContractEmailHtml, isValidEmail } from "../lib/mailer";
import { resolveOfficialSenderEmail } from "../lib/mail-settings";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";

// multer — disk storage for signed contract uploads, PDF only, 20 MB limit
const signedUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, _file, cb) => {
      const id = req.params["id"] ?? "0";
      const hex = crypto.randomBytes(8).toString("hex");
      cb(null, `signed-contract-${id}-${hex}.pdf`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === "application/pdf");
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const SERVICE_TYPE_LABELS: Record<string, string> = {
  FULL_REP: "تمثيل كامل",
  PARTIAL_REP: "تمثيل جزئي",
  OBJECTION: "اعتراض",
  CASSATION_REQUEST: "طلب تمييز",
  CONTRACT_DRAFTING: "صياغة عقد",
  CONTRACT_REVIEW: "مراجعة عقد",
  LEGAL_CONTRACT_CREATION: "إنشاء عقد قانوني",
  CONSULTATION: "استشارة",
};

const MAX_CLAUSES = 50;
const MAX_CLAUSE_LENGTH = 2000;

// Returns a cleaned array of clause strings, or null when the input is invalid.
function sanitizeClauses(input: unknown): string[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return null;
  if (input.length > MAX_CLAUSES) return null;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") return null;
    if (item.length > MAX_CLAUSE_LENGTH) return null;
    const trimmed = item.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

const router = Router();
router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  try {
    const { clientId } = req.query as { clientId?: string };
    const isManager = req.auth!.role === "SYSTEM_MANAGER";

    const rows = await db
      .select({ contract: contractsTable, clientName: clientsTable.name, clientPhone: clientsTable.phone })
      .from(contractsTable)
      .leftJoin(clientsTable, eq(contractsTable.clientId, clientsTable.id))
      .where(scoped(req, contractsTable.tenantId, clientId ? eq(contractsTable.clientId, parseInt(clientId, 10)) : undefined));

    res.json(rows.map(({ contract, clientName, clientPhone }) => ({
      ...contract,
      clientName,
      clientPhone: isManager ? (clientPhone ?? null) : null,
      fees: isManager ? (contract.fees ? parseFloat(contract.fees) : null) : null,
      pdfUrl: isManager ? contract.pdfUrl : null,
      signedPdfUrl: isManager ? contract.signedPdfUrl : null,
      createdAt: contract.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "list contracts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const {
      clientId, serviceType, hijriDate, gregorianDate, preamble, fees, isSigned, customClauses,
      clientNationalId, clientAddress, clientPhone, clientEmail,
      caseNumber, courtName, caseSubject, representationScope,
      feeInstallments,
    } = req.body as {
      clientId: number; serviceType: string; hijriDate: string; gregorianDate?: string;
      preamble?: string; fees?: number; isSigned?: boolean; customClauses?: string[];
      clientNationalId?: string; clientAddress?: string; clientPhone?: string; clientEmail?: string;
      caseNumber?: string; courtName?: string; caseSubject?: string; representationScope?: string;
      feeInstallments?: Array<{ description: string; amount: number; refundable: boolean }>;
    };
    const sanitizedClauses = sanitizeClauses(customClauses);
    if (sanitizedClauses === null) {
      res.status(400).json({ error: "البنود الإضافية غير صالحة." });
      return;
    }
    const tenantId = tenantStamp(req);
    const [client] = await db.select({ id: clientsTable.id }).from(clientsTable)
      .where(scoped(req, clientsTable.tenantId, eq(clientsTable.id, clientId))).limit(1);
    if (!client) { res.status(400).json({ error: "Client not found" }); return; }

    // Compute next seqNumber for this tenant (year-agnostic, ever-increasing)
    const [{ maxSeq }] = await db
      .select({ maxSeq: max(contractsTable.seqNumber) })
      .from(contractsTable)
      .where(eq(contractsTable.tenantId, tenantId));
    const nextSeq = (maxSeq ?? 0) + 1;

    const [contract] = await db.insert(contractsTable).values({
      tenantId,
      clientId,
      serviceType: serviceType as any,
      hijriDate,
      gregorianDate: gregorianDate || null,
      clientNationalId: clientNationalId || null,
      clientAddress: clientAddress || null,
      clientPhone: clientPhone || null,
      clientEmail: clientEmail || null,
      caseNumber: caseNumber || null,
      courtName: courtName || null,
      caseSubject: caseSubject || null,
      representationScope: representationScope || null,
      preamble: preamble || null,
      fees: fees?.toString(),
      feeInstallments: feeInstallments ?? null,
      isSigned: isSigned ?? false,
      customClauses: sanitizedClauses,
      seqNumber: nextSeq,
    }).returning();

    await db.insert(activityLogTable).values({
      tenantId,
      type: "CONTRACT_CREATED",
      description: `تم إنشاء عقد جديد - ${serviceType}`,
      entityId: contract.id,
      entityType: "contract",
    });

    res.status(201).json({
      ...contract,
      fees: contract.fees ? parseFloat(contract.fees) : null,
      createdAt: contract.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "create contract error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Count contracts that have fee installments ────────────────────────────────
router.get("/installments/count", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };

    const conditions: any[] = [];
    // Only contracts that have at least one installment entry
    conditions.push(sql`${contractsTable.feeInstallments} IS NOT NULL AND jsonb_array_length(${contractsTable.feeInstallments}) > 0`);

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        conditions.push(gte(contractsTable.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(contractsTable.createdAt, toDate));
      }
    }

    const tenantCondition = scoped(req, contractsTable.tenantId);
    const whereClause = and(tenantCondition, ...conditions);

    // Count individual installments (sum of array lengths), not contracts
    const [result] = await db
      .select({ count: sql<number>`cast(coalesce(sum(jsonb_array_length(${contractsTable.feeInstallments})), 0) as int)` })
      .from(contractsTable)
      .where(whereClause);

    res.json({ count: result?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "count installments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Export fee installments as Excel ─────────────────────────────────────────
router.get("/installments/export-excel", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };

    const conditions: any[] = [];
    conditions.push(sql`${contractsTable.feeInstallments} IS NOT NULL AND jsonb_array_length(${contractsTable.feeInstallments}) > 0`);

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        conditions.push(gte(contractsTable.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(contractsTable.createdAt, toDate));
      }
    }

    const tenantCondition = scoped(req, contractsTable.tenantId);
    const whereClause = and(tenantCondition, ...conditions);

    const rows = await db
      .select({ contract: contractsTable, clientName: clientsTable.name })
      .from(contractsTable)
      .leftJoin(clientsTable, eq(contractsTable.clientId, clientsTable.id))
      .where(whereClause)
      .orderBy(contractsTable.createdAt);

    const SERVICE_TYPE_AR: Record<string, string> = {
      FULL_REP: "تمثيل كامل",
      PARTIAL_REP: "تمثيل جزئي",
      OBJECTION: "اعتراض",
      CASSATION_REQUEST: "طلب تمييز",
      CONTRACT_DRAFTING: "صياغة عقد",
      CONTRACT_REVIEW: "مراجعة عقد",
      LEGAL_CONTRACT_CREATION: "إنشاء عقد قانوني",
      CONSULTATION: "استشارة",
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Law Firm ERP";
    const sheet = workbook.addWorksheet("الأقساط", { views: [{ rightToLeft: true }] });

    sheet.columns = [
      { key: "clientName",   width: 24 },
      { key: "serviceType",  width: 20 },
      { key: "hijriDate",    width: 18 },
      { key: "description",  width: 32 },
      { key: "amount",       width: 18 },
      { key: "refundable",   width: 14 },
    ];

    // ── Metadata rows ─────────────────────────────────────────────────────────
    const now = new Date();
    const exportDateStr = now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
    const dateRangeStr = from && to
      ? `${from} ← ${to}`
      : from ? `من ${from}` : to ? `إلى ${to}` : "جميع السجلات";

    const metaStyle: Partial<ExcelJS.Style> = {
      font: { bold: false, size: 10, color: { argb: "FF374151" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } },
      alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
    };
    const metaLabelStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, size: 10, color: { argb: "FF1E3A5F" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } },
      alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
    };

    const metaRow1 = sheet.addRow(["تاريخ التصدير:", exportDateStr]);
    metaRow1.height = 18;
    metaRow1.getCell(1).style = metaLabelStyle;
    metaRow1.getCell(2).style = metaStyle;

    const metaRow2 = sheet.addRow(["فترة التصفية:", dateRangeStr]);
    metaRow2.height = 18;
    metaRow2.getCell(1).style = metaLabelStyle;
    metaRow2.getCell(2).style = metaStyle;

    const blankMeta = sheet.addRow([]);
    blankMeta.height = 6;

    // ── Header row ────────────────────────────────────────────────────────────
    const headerRow = sheet.addRow([
      "اسم العميل", "نوع الخدمة", "التاريخ الهجري",
      "وصف القسط", "مبلغ القسط (﷼)", "قابل للاسترداد",
    ]);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
    headerRow.height = 22;
    const headerRowNum = headerRow.number;
    sheet.views = [{ state: "frozen", ySplit: headerRowNum, rightToLeft: true }];

    // Expand each contract's feeInstallments array into individual rows
    for (const { contract, clientName } of rows) {
      const installments = (contract.feeInstallments as Array<{ description: string; amount: number; refundable: boolean }>) ?? [];
      for (const inst of installments) {
        sheet.addRow({
          clientName: clientName || "—",
          serviceType: SERVICE_TYPE_AR[contract.serviceType] ?? contract.serviceType,
          hijriDate: contract.hijriDate,
          description: inst.description,
          amount: Number(inst.amount),
          refundable: inst.refundable ? "نعم" : "لا",
        });
      }
    }

    sheet.eachRow((row, rowNum) => {
      if (rowNum <= headerRowNum) return;
      row.alignment = { readingOrder: "rtl", vertical: "middle" };
      if ((rowNum - headerRowNum) % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
      }
    });

    let filename = "installments";
    if (from && to) filename += `-${from}_${to}`;
    else if (from) filename += `-from-${from}`;
    else if (to) filename += `-to-${to}`;
    filename += ".xlsx";

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error({ err }, "export installments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const isManager = req.auth!.role === "SYSTEM_MANAGER";
    const [row] = await db
      .select({ contract: contractsTable, clientName: clientsTable.name, clientPhone: clientsTable.phone })
      .from(contractsTable)
      .leftJoin(clientsTable, eq(contractsTable.clientId, clientsTable.id))
      .where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Contract not found" }); return; }
    res.json({
      ...row.contract,
      clientName: row.clientName,
      clientPhone: isManager ? (row.clientPhone ?? null) : null,
      fees: isManager ? (row.contract.fees ? parseFloat(row.contract.fees) : null) : null,
      pdfUrl: isManager ? row.contract.pdfUrl : null,
      signedPdfUrl: isManager ? row.contract.signedPdfUrl : null,
      createdAt: row.contract.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "get contract error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const {
      serviceType, hijriDate, gregorianDate, preamble, fees, isSigned, customClauses,
      clientNationalId, clientAddress, clientPhone, clientEmail,
      caseNumber, courtName, caseSubject, representationScope,
      feeInstallments,
    } = req.body as {
      serviceType?: string; hijriDate?: string; gregorianDate?: string; preamble?: string;
      fees?: number; isSigned?: boolean; customClauses?: string[];
      clientNationalId?: string; clientAddress?: string; clientPhone?: string; clientEmail?: string;
      caseNumber?: string; courtName?: string; caseSubject?: string; representationScope?: string;
      feeInstallments?: Array<{ description: string; amount: number; refundable: boolean }>;
    };
    let sanitizedClauses: string[] | null = null;
    if (customClauses !== undefined) {
      sanitizedClauses = sanitizeClauses(customClauses);
      if (sanitizedClauses === null) {
        res.status(400).json({ error: "البنود الإضافية غير صالحة." });
        return;
      }
    }
    const [contract] = await db.update(contractsTable).set({
      ...(serviceType && { serviceType: serviceType as any }),
      ...(hijriDate && { hijriDate }),
      ...(gregorianDate !== undefined && { gregorianDate: gregorianDate || null }),
      ...(preamble !== undefined && { preamble }),
      ...(fees !== undefined && { fees: fees.toString() }),
      ...(isSigned !== undefined && { isSigned }),
      ...(customClauses !== undefined && { customClauses: sanitizedClauses! }),
      ...(clientNationalId !== undefined && { clientNationalId: clientNationalId || null }),
      ...(clientAddress !== undefined && { clientAddress: clientAddress || null }),
      ...(clientPhone !== undefined && { clientPhone: clientPhone || null }),
      ...(clientEmail !== undefined && { clientEmail: clientEmail || null }),
      ...(caseNumber !== undefined && { caseNumber: caseNumber || null }),
      ...(courtName !== undefined && { courtName: courtName || null }),
      ...(caseSubject !== undefined && { caseSubject: caseSubject || null }),
      ...(representationScope !== undefined && { representationScope: representationScope || null }),
      ...(feeInstallments !== undefined && { feeInstallments: feeInstallments ?? null }),
    }).where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id))).returning();
    if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
    res.json({ ...contract, fees: contract.fees ? parseFloat(contract.fees) : null, createdAt: contract.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "update contract error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/generate-pdf", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (Number.isNaN(id)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const [row] = await db
      .select({
        contract: contractsTable,
        clientName: clientsTable.name,
        clientPhone: clientsTable.phone,
        clientEmail: clientsTable.email,
        clientNationalIdDb: clientsTable.nationalId,
        clientAddressDb: clientsTable.address,
        agencyNumber: clientsTable.agencyNumber,
        agencyEndDate: clientsTable.agencyEndDate,
        agencySource: clientsTable.agencySource,
      })
      .from(contractsTable)
      .leftJoin(clientsTable, eq(contractsTable.clientId, clientsTable.id))
      .where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    let pdfUrl: string;
    try {
      pdfUrl = await generateContractPdf({
        id: row.contract.id,
        seqNumber: row.contract.seqNumber,
        clientName: row.clientName ?? "غير محدد",
        clientNationalId: row.contract.clientNationalId || row.clientNationalIdDb,
        clientAddress: row.contract.clientAddress || row.clientAddressDb,
        clientPhone: row.contract.clientPhone || row.clientPhone,
        clientEmail: row.contract.clientEmail || row.clientEmail,
        agencyNumber: row.agencyNumber,
        agencyEndDate: row.agencyEndDate,
        agencySource: row.agencySource,
        serviceType: row.contract.serviceType,
        hijriDate: row.contract.hijriDate,
        gregorianDate: row.contract.gregorianDate,
        caseNumber: row.contract.caseNumber,
        courtName: row.contract.courtName,
        caseSubject: row.contract.caseSubject,
        representationScope: row.contract.representationScope,
        preamble: row.contract.preamble,
        fees: row.contract.fees,
        feeInstallments: (row.contract.feeInstallments as any) ?? null,
        isSigned: row.contract.isSigned,
        customClauses: row.contract.customClauses ?? [],
        createdAt: row.contract.createdAt,
      });
    } catch (pdfErr) {
      req.log.error({ err: pdfErr }, "puppeteer PDF generation failed");
      res.status(500).json({ error: "فشل توليد ملف PDF. يرجى المحاولة مرة أخرى." });
      return;
    }

    await db.update(contractsTable).set({ pdfUrl }).where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)));

    await db.insert(activityLogTable).values({
      tenantId: tenantStamp(req),
      type: "CONTRACT_PDF_GENERATED",
      description: `تم توليد ملف PDF للعقد رقم ${id}`,
      entityId: id,
      entityType: "contract",
    });

    res.json({ pdfUrl });
  } catch (err) {
    logger.error({ err }, "generate contract pdf error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/send", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (Number.isNaN(id)) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    if (!isMailerConfigured()) {
      res.status(503).json({
        error: "خدمة البريد غير مهيأة. يرجى إضافة مفتاح RESEND_API_KEY أولاً.",
      });
      return;
    }
    const senderEmail = await resolveOfficialSenderEmail(tenantStamp(req));
    if (!senderEmail) {
      res.status(503).json({
        error: "لم يتم تحديد البريد الرسمي للمرسل. يرجى إضافته من صفحة الإعدادات.",
      });
      return;
    }

    const [row] = await db
      .select({ contract: contractsTable, client: clientsTable })
      .from(contractsTable)
      .leftJoin(clientsTable, eq(contractsTable.clientId, clientsTable.id))
      .where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const { contract, client } = row;

    if (!contract.pdfUrl) {
      res.status(400).json({ error: "لم يتم توليد ملف PDF لهذا العقد بعد. يرجى توليده أولاً." });
      return;
    }
    if (!client?.email) {
      res.status(400).json({ error: "لا يوجد بريد إلكتروني مسجل لهذا العميل." });
      return;
    }
    if (!isValidEmail(client.email)) {
      res.status(400).json({ error: "البريد الإلكتروني المسجل لهذا العميل غير صالح. يرجى تحديث بيانات العميل." });
      return;
    }

    // Locate the generated PDF on disk from the stored pdfUrl (/api/uploads/<filename>)
    let effectivePdfUrl = contract.pdfUrl;
    let filename = path.basename(effectivePdfUrl);
    let pdfPath = path.join(UPLOADS_DIR, filename);
    if (!pdfPath.startsWith(UPLOADS_DIR) || !fs.existsSync(pdfPath)) {
      // The stored file may have been wiped by a redeploy (ephemeral filesystem).
      // Regenerate the PDF transparently instead of failing.
      req.log.warn({ contractId: id, pdfUrl: effectivePdfUrl }, "contract PDF missing on disk, regenerating");
      try {
        effectivePdfUrl = await generateContractPdf({
          id: contract.id,
          seqNumber: contract.seqNumber,
          clientName: client.name ?? "غير محدد",
          clientNationalId: contract.clientNationalId || client.nationalId,
          clientAddress: contract.clientAddress || (client as any).address,
          clientPhone: contract.clientPhone || client.phone,
          clientEmail: contract.clientEmail || client.email,
          serviceType: contract.serviceType,
          hijriDate: contract.hijriDate,
          gregorianDate: contract.gregorianDate,
          caseNumber: contract.caseNumber,
          courtName: contract.courtName,
          caseSubject: contract.caseSubject,
          representationScope: contract.representationScope,
          preamble: contract.preamble,
          fees: contract.fees,
          feeInstallments: (contract.feeInstallments as any) ?? null,
          isSigned: contract.isSigned,
          customClauses: contract.customClauses ?? [],
          createdAt: contract.createdAt,
        });
      } catch (pdfErr) {
        req.log.error({ err: pdfErr }, "PDF regeneration before send failed");
        res.status(500).json({ error: "ملف العقد غير موجود على الخادم وتعذّرت إعادة توليده. يرجى المحاولة مرة أخرى." });
        return;
      }
      await db.update(contractsTable).set({ pdfUrl: effectivePdfUrl }).where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)));
      filename = path.basename(effectivePdfUrl);
      pdfPath = path.join(UPLOADS_DIR, filename);
    }

    const serviceTypeLabel = SERVICE_TYPE_LABELS[contract.serviceType] ?? contract.serviceType;

    try {
      await sendMail({
        from: senderEmail,
        to: client.email,
        subject: "نسخة العقد للمراجعة - مكتب المحامي ماجد بن سلطان السبيعي",
        html: buildContractEmailHtml({
          clientName: client.name,
          serviceTypeLabel,
          hijriDate: contract.hijriDate,
          contractId: contract.id,
        }),
        attachments: [{ filename: `عقد-${contract.id}.pdf`, path: pdfPath }],
      });
    } catch (mailErr) {
      req.log.error({ err: mailErr }, "contract email sending failed");
      const resendName = (mailErr as { resendName?: string })?.resendName;
      let msg = "فشل إرسال البريد الإلكتروني عبر Resend. حاول مجدداً لاحقاً.";
      if (resendName === "missing_api_key" || resendName === "invalid_api_key" || resendName === "restricted_api_key") {
        msg = "مفتاح Resend غير صالح أو مقيد. يرجى التحقق من RESEND_API_KEY.";
      } else if (resendName === "missing_from_address") {
        msg = "لم يتم تحديد البريد الرسمي للمرسل. يرجى إضافته من صفحة الإعدادات.";
      } else if (resendName === "validation_error" || resendName === "invalid_from_address") {
        msg = "رفض Resend الطلب: تحقق من البريد الرسمي في صفحة الإعدادات وأن نطاقه موثق في Resend.";
      } else if (resendName === "rate_limit_exceeded" || resendName === "daily_quota_exceeded") {
        msg = "تم تجاوز حد الإرسال في Resend. حاول مرة أخرى لاحقاً.";
      }
      res.status(502).json({ error: msg });
      return;
    }

    // TODO: WhatsApp Cloud API integration.
    // When ready, send the contract link/document to the client's WhatsApp number:
    //
    // async function sendContractViaWhatsApp(phone: string, pdfPath: string) {
    //   // Call WhatsApp Cloud API here with client.phone, e.g.:
    //   // await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    //   //   method: "POST",
    //   //   headers: {
    //   //     Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    //   //     "Content-Type": "application/json",
    //   //   },
    //   //   body: JSON.stringify({
    //   //     messaging_product: "whatsapp",
    //   //     to: phone, // client.phone in international format
    //   //     type: "document",
    //   //     document: { link: publicPdfUrl, filename: "عقد.pdf" },
    //   //   }),
    //   // });
    // }
    // if (client.phone) await sendContractViaWhatsApp(client.phone, pdfPath);

    await db.insert(activityLogTable).values({
      tenantId: tenantStamp(req),
      type: "CONTRACT_SENT",
      description: `تم إرسال العقد رقم ${id} إلى العميل ${client.name} عبر البريد الإلكتروني`,
      entityId: id,
      entityType: "contract",
    });

    res.json({ sent: true, sentTo: client.email });
  } catch (err) {
    logger.error({ err }, "send contract error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/upload-signed", requireSystemManager, (req: Request, res: Response, next) => {
  signedUpload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "حجم الملف يتجاوز الحد المسموح به (20 ميغابايت)." });
      return;
    }
    if (err) { next(err); return; }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (Number.isNaN(id)) { res.status(404).json({ error: "Contract not found" }); return; }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "لم يتم إرفاق ملف. يرجى اختيار ملف PDF." });
      return;
    }
    if (file.mimetype !== "application/pdf") {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: "يجب أن يكون الملف بصيغة PDF." });
      return;
    }

    // Check contract belongs to this tenant
    const [existing] = await db
      .select({ id: contractsTable.id })
      .from(contractsTable)
      .where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)))
      .limit(1);
    if (!existing) {
      fs.unlinkSync(file.path);
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const signedPdfUrl = `/api/uploads/${file.filename}`;
    await db.update(contractsTable)
      .set({ signedPdfUrl })
      .where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)));

    await db.insert(activityLogTable).values({
      tenantId: tenantStamp(req),
      type: "CONTRACT_SIGNED",
      description: `تم رفع نسخة العقد الموقع للعقد رقم ${id}`,
      entityId: id,
      entityType: "contract",
    });

    res.json({ signedPdfUrl });
  } catch (err) {
    logger.error({ err }, "upload signed contract error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    await db.delete(contractsTable).where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, id)));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "delete contract error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
