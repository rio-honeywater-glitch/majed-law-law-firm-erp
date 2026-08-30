import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { executionsTable, transferOrderLogsTable, activityLogTable, casesTable, usersTable, tenantsTable } from "@workspace/db";
import { eq, desc, sql, inArray, gte, lte, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import ExcelJS from "exceljs";
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const router = Router();
router.use(requireAuth);

const ROLE_AR: Record<string, string> = {
  SYSTEM_MANAGER: "مدير النظام",
  TECHNICIAN: "موظف",
};

async function getWithdrawalBy(userId: number, role: string): Promise<string> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const name = u?.name || "غير معروف";
  return `${name} / ${ROLE_AR[role] ?? role}`;
}

function toExecutionJson(e: any) {
  return {
    ...e,
    totalAmount: parseFloat(e.totalAmount),
    paidAmount: parseFloat(e.paidAmount),
    remainingAmount: parseFloat(e.remainingAmount),
    lastReminderDate: e.lastReminderDate ? e.lastReminderDate.toISOString() : null,
    lastWithdrawalAt: e.lastWithdrawalAt ? e.lastWithdrawalAt.toISOString() : null,
    lastWithdrawalBy: e.lastWithdrawalBy ?? null,
    lastTransferOrderAt: e.lastTransferOrderAt ? e.lastTransferOrderAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
  };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

router.get("/", async (req: Request, res: Response) => {
  try {
    const { caseId, status } = req.query as { caseId?: string; status?: string };
    let rows = await db.select().from(executionsTable).where(scoped(req, executionsTable.tenantId));
    if (caseId) rows = rows.filter(r => r.caseId === parseInt(caseId, 10));
    if (status) rows = rows.filter(r => r.status === status);

    // Fetch transfer order counts for all returned executions in one query
    const counts: Record<number, number> = {};
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const countRows = await db
        .select({ executionId: transferOrderLogsTable.executionId, count: sql<number>`cast(count(*) as int)` })
        .from(transferOrderLogsTable)
        .where(inArray(transferOrderLogsTable.executionId, ids))
        .groupBy(transferOrderLogsTable.executionId);
      for (const cr of countRows) counts[cr.executionId] = cr.count;
    }

    res.json(rows.map(r => ({ ...toExecutionJson(r), transferOrderCount: counts[r.id] ?? 0 })));
  } catch (err) {
    logger.error({ err }, "list executions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { caseId, executionNumber, type, totalAmount, paidAmount, status } = req.body as {
      caseId: number; executionNumber?: string; type?: string;
      totalAmount: number; paidAmount: number; status?: string;
    };
    const tenantId = tenantStamp(req);
    const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, caseId))).limit(1);
    if (!caseRow) { res.status(400).json({ error: "Case not found" }); return; }

    const remaining = totalAmount - paidAmount;
    const [execution] = await db.insert(executionsTable).values({
      tenantId,
      caseId,
      executionNumber,
      type,
      totalAmount: totalAmount.toString(),
      paidAmount: paidAmount.toString(),
      remainingAmount: remaining.toString(),
      status: (status as any) ?? "ACTIVE",
    }).returning();

    await db.insert(activityLogTable).values({
      tenantId,
      type: "EXECUTION_CREATED",
      description: `تم إنشاء تنفيذ جديد${executionNumber ? `: ${executionNumber}` : ""}`,
      entityId: execution.id,
      entityType: "execution",
    });

    res.status(201).json(toExecutionJson(execution));
  } catch (err) {
    logger.error({ err }, "create execution error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Transfer-order summary (must be BEFORE /:id to avoid route collision) ──
// ── Export all transfer-order logs as CSV (must be BEFORE /:id) ─────────────
// ── Count transfer-order logs for a date range (preview before export) ──────
// ── Count executions for a given status / date range (preview before export) ─
router.get("/count", async (req: Request, res: Response) => {
  try {
    const { status, from, to } = req.query as { status?: string; from?: string; to?: string };

    const conditions: ReturnType<typeof gte>[] = [];
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        conditions.push(gte(executionsTable.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(executionsTable.createdAt, toDate));
      }
    }
    if (status) {
      conditions.push(eq(executionsTable.status, status as any));
    }

    const tenantCondition = scoped(req, executionsTable.tenantId);
    const whereClause = conditions.length > 0 ? and(tenantCondition, ...conditions) : tenantCondition;

    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(executionsTable)
      .where(whereClause);

    res.json({ count: result?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "count executions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Export executions as Excel ────────────────────────────────────────────────
router.get("/export-excel", async (req: Request, res: Response) => {
  try {
    const { status, from, to } = req.query as { status?: string; from?: string; to?: string };

    const conditions: ReturnType<typeof gte>[] = [];
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        conditions.push(gte(executionsTable.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(executionsTable.createdAt, toDate));
      }
    }
    if (status) {
      conditions.push(eq(executionsTable.status, status as any));
    }

    const tenantCondition = scoped(req, executionsTable.tenantId);
    const whereClause = conditions.length > 0 ? and(tenantCondition, ...conditions) : tenantCondition;

    const rows = await db
      .select()
      .from(executionsTable)
      .where(whereClause)
      .orderBy(desc(executionsTable.createdAt));

    const STATUS_AR: Record<string, string> = {
      ACTIVE: "نشط",
      FULL_PAYMENT: "سداد كامل",
      PARTIAL_PAYMENT: "سداد جزئي",
      SETTLEMENT: "تسوية",
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Law Firm ERP";
    const sheet = workbook.addWorksheet("التنفيذات", { views: [{ rightToLeft: true }] });

    sheet.columns = [
      { key: "executionNumber",      width: 22 },
      { key: "type",                 width: 20 },
      { key: "totalAmount",          width: 18 },
      { key: "paidAmount",           width: 18 },
      { key: "remainingAmount",      width: 18 },
      { key: "status",               width: 16 },
      { key: "lastWithdrawalAt",     width: 24 },
      { key: "lastWithdrawalBy",     width: 24 },
      { key: "lastTransferOrderAt",  width: 24 },
      { key: "daysSinceTransfer",    width: 22 },
      { key: "createdAt",            width: 24 },
    ];

    // ── Metadata rows at the top ──────────────────────────────────────────────
    const now = new Date();
    const exportDateStr = now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
    const dateRangeStr = from && to
      ? `${from} ← ${to}`
      : from
        ? `من ${from}`
        : to
          ? `إلى ${to}`
          : "جميع السجلات";

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

    // ── Column header row ─────────────────────────────────────────────────────
    const headerRow = sheet.addRow([
      "رقم التنفيذ", "النوع", "المبلغ الإجمالي", "المبلغ المسدد", "المتبقي",
      "الحالة", "آخر سحب", "بواسطة", "آخر أمر تحويل", "الأيام منذ آخر أمر", "تاريخ الإنشاء",
    ]);
    // Map header cells to column keys so getCell("key") works in data rows
    headerRow.getCell(1).name = "executionNumber";

    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
    headerRow.height = 22;
    const headerRowNum = headerRow.number;
    sheet.views = [{ state: "frozen", ySplit: headerRowNum, rightToLeft: true }];

    const lateExecRows: number[] = []; // row numbers where daysSince > 7

    for (const r of rows) {
      const daysSince = r.lastTransferOrderAt
        ? Math.floor((now.getTime() - r.lastTransferOrderAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const excelRow = sheet.addRow({
        executionNumber: r.executionNumber || String(r.id),
        type: r.type || "—",
        totalAmount: parseFloat(r.totalAmount),
        paidAmount: parseFloat(r.paidAmount),
        remainingAmount: parseFloat(r.remainingAmount),
        status: STATUS_AR[r.status] ?? r.status,
        lastWithdrawalAt: r.lastWithdrawalAt
          ? r.lastWithdrawalAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
          : "—",
        lastWithdrawalBy: r.lastWithdrawalBy || "—",
        lastTransferOrderAt: r.lastTransferOrderAt
          ? r.lastTransferOrderAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
          : "—",
        daysSinceTransfer: daysSince !== null ? daysSince : "—",
        createdAt: r.createdAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
      });
      if (daysSince !== null && daysSince > 7) {
        lateExecRows.push(excelRow.number);
      }
    }

    sheet.eachRow((row, rowNum) => {
      if (rowNum <= headerRowNum) return; // skip metadata + header rows
      row.alignment = { readingOrder: "rtl", vertical: "middle" };
      // Alternate shading: odd/even relative to the first data row
      if ((rowNum - headerRowNum) % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
      }
    });

    // Apply red highlight to "الأيام منذ آخر أمر" cells (column 10) that exceed 7 days
    for (const rowNum of lateExecRows) {
      const cell = sheet.getRow(rowNum).getCell(10); // daysSinceTransfer column
      cell.font = { bold: true, color: { argb: "FFCC0000" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };
    }

    let filename = "executions";
    if (status) filename += `-${status}`;
    if (from && to) filename += `-${from}_${to}`;
    else if (from) filename += `-from-${from}`;
    else if (to) filename += `-to-${to}`;
    filename += ".xlsx";

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error({ err }, "export executions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/transfer-order-logs/count", async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };

    const dateConditions: ReturnType<typeof gte>[] = [];
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        dateConditions.push(gte(transferOrderLogsTable.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        dateConditions.push(lte(transferOrderLogsTable.createdAt, toDate));
      }
    }

    const tenantCondition = scoped(req, executionsTable.tenantId);
    const whereClause = dateConditions.length > 0
      ? and(tenantCondition, ...dateConditions)
      : tenantCondition;

    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(transferOrderLogsTable)
      .innerJoin(executionsTable, eq(transferOrderLogsTable.executionId, executionsTable.id))
      .where(whereClause);

    res.json({ count: result?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "count transfer order logs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/transfer-order-logs/export", async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };

    // Build date range filter on transferOrderLogsTable.createdAt
    const dateConditions: ReturnType<typeof gte>[] = [];
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        dateConditions.push(gte(transferOrderLogsTable.createdAt, fromDate));
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        dateConditions.push(lte(transferOrderLogsTable.createdAt, toDate));
      }
    }

    const tenantCondition = scoped(req, executionsTable.tenantId);
    const whereClause = dateConditions.length > 0
      ? and(tenantCondition, ...dateConditions)
      : tenantCondition;

    // Join logs with executions to get execution numbers, scoped by tenant
    const rows = await db
      .select({
        executionId: transferOrderLogsTable.executionId,
        executionNumber: executionsTable.executionNumber,
        createdAt: transferOrderLogsTable.createdAt,
        createdBy: transferOrderLogsTable.createdBy,
        lastTransferOrderAt: executionsTable.lastTransferOrderAt,
      })
      .from(transferOrderLogsTable)
      .innerJoin(executionsTable, eq(transferOrderLogsTable.executionId, executionsTable.id))
      .where(whereClause)
      .orderBy(desc(transferOrderLogsTable.createdAt));

    // Build xlsx workbook with formatted header row
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Law Firm ERP";
    const sheet = workbook.addWorksheet("أوامر التحويل", { views: [{ rightToLeft: true }] });

    // Define columns
    sheet.columns = [
      { header: "رقم التنفيذ",            key: "execNum",              width: 20 },
      { header: "تاريخ الأمر",            key: "dateStr",              width: 28 },
      { header: "اسم من أصدره",           key: "name",                 width: 25 },
      { header: "الدور الوظيفي",          key: "role",                 width: 18 },
      { header: "آخر أمر تحويل",          key: "lastTransferOrder",    width: 28 },
      { header: "الأيام منذ آخر أمر",    key: "daysSinceLastTransfer", width: 22 },
    ];

    // Style header row: bold, blue background, white text, freeze it
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
    headerRow.height = 22;
    sheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];

    // Add data rows
    const exportNow = new Date();
    const lateLogRows: number[] = []; // row numbers where daysSince > 7

    for (const r of rows) {
      const execNum = r.executionNumber || String(r.executionId);
      const dateStr = r.createdAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
      const parts = r.createdBy.split(" / ");
      const name = parts[0]?.trim() || r.createdBy;
      const role = parts.slice(1).join(" / ").trim() || "";
      const lastTransferOrder = r.lastTransferOrderAt
        ? r.lastTransferOrderAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
        : "—";
      const daysSinceLastTransfer = r.lastTransferOrderAt
        ? Math.floor((exportNow.getTime() - r.lastTransferOrderAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const excelRow = sheet.addRow({
        execNum,
        dateStr,
        name,
        role,
        lastTransferOrder,
        daysSinceLastTransfer: daysSinceLastTransfer !== null ? daysSinceLastTransfer : "—",
      });
      if (daysSinceLastTransfer !== null && daysSinceLastTransfer > 7) {
        lateLogRows.push(excelRow.number);
      }
    }

    // Alternate row shading for readability
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      row.alignment = { readingOrder: "rtl", vertical: "middle" };
      if (rowNum % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
      }
    });

    // Apply red highlight to "الأيام منذ آخر أمر" cells that exceed 7 days (after row fill pass)
    for (const rowNum of lateLogRows) {
      const cell = sheet.getRow(rowNum).getCell("daysSinceLastTransfer");
      cell.font = { bold: true, color: { argb: "FFCC0000" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };
    }

    // ── Fetch active executions count for the tenant (for average metric) ───────
    const activeExecutionsRows = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(executionsTable)
      .where(and(scoped(req, executionsTable.tenantId), eq(executionsTable.status, "ACTIVE")));
    const activeExecutionsCount = activeExecutionsRows[0]?.count ?? 0;

    // ── Summary sheet: count of transfer orders per execution ─────────────────
    const summaryMap = new Map<number, { execNum: string; count: number; lastTransferOrderAt: Date | null }>();
    for (const r of rows) {
      const execNum = r.executionNumber || String(r.executionId);
      const entry = summaryMap.get(r.executionId);
      if (entry) {
        entry.count += 1;
      } else {
        summaryMap.set(r.executionId, { execNum, count: 1, lastTransferOrderAt: r.lastTransferOrderAt });
      }
    }
    const totalTransferOrders = rows.length;
    const summaryRows = Array.from(summaryMap.values())
      .map(s => ({
        ...s,
        pct: totalTransferOrders > 0 ? Math.round((s.count / totalTransferOrders) * 1000) / 10 : 0,
        daysSince: s.lastTransferOrderAt
          ? Math.floor((exportNow.getTime() - s.lastTransferOrderAt.getTime()) / (1000 * 60 * 60 * 24))
          : null,
      }))
      .sort((a, b) => b.pct - a.pct);
    const avgPerActive = activeExecutionsCount > 0
      ? Math.round((totalTransferOrders / activeExecutionsCount) * 100) / 100
      : 0;

    const summarySheet = workbook.addWorksheet("ملخص", { views: [{ rightToLeft: true }] });

    // ── Global metrics block at the top ──────────────────────────────────────
    const metricLabelStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, size: 11 },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } },
      alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
      border: {
        top: { style: "thin", color: { argb: "FFCCD6E0" } },
        bottom: { style: "thin", color: { argb: "FFCCD6E0" } },
        left: { style: "thin", color: { argb: "FFCCD6E0" } },
        right: { style: "thin", color: { argb: "FFCCD6E0" } },
      },
    };
    const metricValueStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, size: 12, color: { argb: "FF1E3A5F" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } },
      alignment: { horizontal: "center", vertical: "middle" },
      border: {
        top: { style: "thin", color: { argb: "FFCCD6E0" } },
        bottom: { style: "thin", color: { argb: "FFCCD6E0" } },
        left: { style: "thin", color: { argb: "FFCCD6E0" } },
        right: { style: "thin", color: { argb: "FFCCD6E0" } },
      },
    };

    // Set column widths before adding rows
    summarySheet.columns = [
      { key: "col1", width: 34 },
      { key: "col2", width: 18 },
      { key: "col3", width: 22 },
      { key: "col4", width: 24 },
    ];

    // Title row
    const titleRow = summarySheet.addRow(["ملخص أوامر التحويل", "", "", ""]);
    const titleRowNum = titleRow.number;
    summarySheet.mergeCells(`A${titleRowNum}:D${titleRowNum}`);
    const titleCell = summarySheet.getCell(`A${titleRowNum}`);
    titleCell.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
    titleRow.height = 26;

    // ── Report metadata rows ──────────────────────────────────────────────────
    const summaryExportDateStr = exportNow.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
    const summaryDateRangeStr = from && to
      ? `${from} ← ${to}`
      : from
        ? `من ${from}`
        : to
          ? `إلى ${to}`
          : "جميع السجلات";

    const sumMetaLabelStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, size: 10, color: { argb: "FF1E3A5F" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } },
      alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
    };
    const sumMetaValueStyle: Partial<ExcelJS.Style> = {
      font: { bold: false, size: 10, color: { argb: "FF374151" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } },
      alignment: { horizontal: "right", vertical: "middle", readingOrder: "rtl" },
    };

    const sMetaRow1 = summarySheet.addRow(["تاريخ التصدير:", summaryExportDateStr, ""]);
    sMetaRow1.height = 18;
    sMetaRow1.getCell(1).style = sumMetaLabelStyle;
    sMetaRow1.getCell(2).style = sumMetaValueStyle;

    const sMetaRow2 = summarySheet.addRow(["فترة التصفية:", summaryDateRangeStr, ""]);
    sMetaRow2.height = 18;
    sMetaRow2.getCell(1).style = sumMetaLabelStyle;
    sMetaRow2.getCell(2).style = sumMetaValueStyle;

    summarySheet.addRow([]); // blank separator after metadata

    // Metric rows
    const metrics: [string, string | number][] = [
      ["إجمالي أوامر التحويل", totalTransferOrders],
      ["عدد الطلبات النشطة", activeExecutionsCount],
      ["متوسط الأوامر لكل طلب نشط", avgPerActive],
    ];
    for (const [label, value] of metrics) {
      const row = summarySheet.addRow([label, value]);
      row.height = 22;
      const labelCell = row.getCell(1);
      const valueCell = row.getCell(2);
      Object.assign(labelCell, metricLabelStyle);
      Object.assign(valueCell, metricValueStyle);
      labelCell.style = metricLabelStyle;
      valueCell.style = metricValueStyle;
    }

    // Blank separator row
    summarySheet.addRow([]);

    // ── Per-execution breakdown section ──────────────────────────────────────
    const breakdownHeaderRow = summarySheet.addRow(["رقم التنفيذ", "إجمالي عدد أوامر التحويل", "النسبة من الإجمالي %", "الأيام منذ آخر أمر"]);
    breakdownHeaderRow.height = 22;
    breakdownHeaderRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    breakdownHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    breakdownHeaderRow.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
    summarySheet.views = [{ rightToLeft: true }];

    const breakdownStartRow = breakdownHeaderRow.number;
    const lateSummaryRows: number[] = []; // row numbers where daysSince > 7
    for (const s of summaryRows) {
      const dataRow = summarySheet.addRow([s.execNum, s.count, s.pct, s.daysSince !== null ? s.daysSince : "—"]);
      if (s.daysSince !== null && s.daysSince > 7) {
        lateSummaryRows.push(dataRow.number);
      }
    }
    summarySheet.eachRow((row, rowNum) => {
      if (rowNum <= breakdownStartRow) return;
      row.alignment = { readingOrder: "rtl", vertical: "middle" };
      if ((rowNum - breakdownStartRow) % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
      }
    });

    // Apply red highlight to "الأيام منذ آخر أمر" cells (column 4) that exceed 7 days
    for (const rowNum of lateSummaryRows) {
      const cell = summarySheet.getRow(rowNum).getCell(4);
      cell.font = { bold: true, color: { argb: "FFCC0000" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };
    }

    // Build filename with optional date range
    let filename = "transfer-order-logs";
    if (from && to) {
      filename += `-${from}_${to}`;
    } else if (from) {
      filename += `-from-${from}`;
    } else if (to) {
      filename += `-to-${to}`;
    }
    filename += ".xlsx";

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error({ err }, "export transfer order logs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Helpers for PDF generation ────────────────────────────────────────────────

function resolveChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Chromium not found. Set CHROMIUM_PATH or install chromium.");
  }
}

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STATUS_AR_PDF: Record<string, string> = {
  ACTIVE: "نشط",
  FULL_PAYMENT: "سداد كامل",
  PARTIAL_PAYMENT: "سداد جزئي",
  SETTLEMENT: "تسوية",
};

function buildSummaryPdfHtml(opts: {
  firmName: string;
  exportDate: string;
  dateRangeStr: string;
  totalCount: number;
  activeCount: number;
  avgPerActive: number | null;
  totalTransferOrders: number;
  rows: Array<{
    executionNumber: string | null;
    type: string | null;
    totalAmount: string;
    paidAmount: string;
    remainingAmount: string;
    status: string;
    lastTransferOrderAt: Date | null;
    createdAt: Date;
  }>;
}): string {
  const { firmName, exportDate, dateRangeStr, totalCount, activeCount, avgPerActive, totalTransferOrders, rows } = opts;
  const now = new Date();

  const tableRows = rows.map((r, i) => {
    const daysSince = r.lastTransferOrderAt
      ? Math.floor((now.getTime() - r.lastTransferOrderAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const late = daysSince !== null && daysSince > 7;
    return `<tr class="${i % 2 === 1 ? "alt" : ""}">
      <td class="num">${i + 1}</td>
      <td>${escHtml(r.executionNumber || "—")}</td>
      <td>${escHtml(r.type || "—")}</td>
      <td class="num">${parseFloat(r.totalAmount).toLocaleString("ar-SA")}</td>
      <td class="num">${parseFloat(r.paidAmount).toLocaleString("ar-SA")}</td>
      <td class="num">${parseFloat(r.remainingAmount).toLocaleString("ar-SA")}</td>
      <td>${escHtml(STATUS_AR_PDF[r.status] ?? r.status)}</td>
      <td class="num${late ? " late" : ""}">${daysSince !== null ? daysSince : "—"}</td>
      <td class="num">${r.createdAt.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" })}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap" rel="stylesheet"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{font-family:"Tajawal","Arial",sans-serif;color:#1a1a1a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:12px;}
  .hdr{background:#1E3A5F;color:#fff;padding:18px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #c9a227;}
  .hdr-firm{font-size:17px;font-weight:800;color:#fff;}
  .hdr-sub{font-size:10px;color:#a0b8d0;margin-top:3px;}
  .hdr-meta{text-align:left;font-size:10px;color:#a0c0e0;line-height:1.9;}
  .hdr-meta b{color:#e6c65c;}
  .body{padding:20px 32px 28px;}
  .section-title{font-size:13px;font-weight:700;color:#1E3A5F;border-bottom:2px solid #c9a227;padding-bottom:4px;margin-bottom:12px;margin-top:18px;}
  .metrics{display:flex;gap:14px;margin-bottom:8px;}
  .metric{flex:1;background:#F0F4F8;border-radius:8px;padding:12px 14px;text-align:center;border:1px solid #dde4ee;}
  .metric .val{font-size:22px;font-weight:800;color:#1E3A5F;}
  .metric .lbl{font-size:10px;color:#6b7280;margin-top:2px;}
  table{width:100%;border-collapse:collapse;font-size:10.5px;}
  thead tr{background:#1E3A5F;color:#fff;}
  thead th{padding:7px 8px;text-align:right;font-weight:700;white-space:nowrap;}
  tbody tr td{padding:6px 8px;border-bottom:1px solid #e5eaf2;}
  tbody tr.alt td{background:#F7F9FC;}
  tbody tr:hover td{background:#EDF3FA;}
  td.num{text-align:center;font-variant-numeric:tabular-nums;}
  td.late{color:#CC0000;font-weight:700;background:#FDE8E8!important;}
  .footer{margin-top:16px;font-size:9px;color:#9ca3af;text-align:center;}
</style>
</head>
<body>
<div class="hdr">
  <div>
    <div class="hdr-firm">${escHtml(firmName)}</div>
    <div class="hdr-sub">تقرير ملخص التنفيذات</div>
  </div>
  <div class="hdr-meta">
    <div>تاريخ التصدير: <b>${escHtml(exportDate)}</b></div>
    <div>فترة التصفية: <b>${escHtml(dateRangeStr)}</b></div>
  </div>
</div>
<div class="body">
  <div class="section-title">المقاييس الإجمالية</div>
  <div class="metrics">
    <div class="metric"><div class="val">${totalCount.toLocaleString("ar-SA")}</div><div class="lbl">إجمالي التنفيذات</div></div>
    <div class="metric"><div class="val">${activeCount.toLocaleString("ar-SA")}</div><div class="lbl">طلبات نشطة</div></div>
    <div class="metric"><div class="val">${totalTransferOrders.toLocaleString("ar-SA")}</div><div class="lbl">إجمالي أوامر التحويل</div></div>
    <div class="metric"><div class="val">${avgPerActive !== null ? avgPerActive.toLocaleString("ar-SA", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}</div><div class="lbl">متوسط الأوامر / نشط</div></div>
  </div>
  <div class="section-title">تفاصيل التنفيذات (${totalCount.toLocaleString("ar-SA")} سجل)</div>
  <table>
    <thead><tr>
      <th>#</th>
      <th>رقم التنفيذ</th>
      <th>النوع</th>
      <th>الإجمالي ﷼</th>
      <th>المسدَّد ﷼</th>
      <th>المتبقي ﷼</th>
      <th>الحالة</th>
      <th>الأيام منذ آخر أمر</th>
      <th>تاريخ الإنشاء</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">تقرير تنفيذات صادر من نظام إدارة الممارسة القانونية · ${escHtml(exportDate)}</div>
</div>
</body>
</html>`;
}

// ── Export summary as PDF ─────────────────────────────────────────────────────
router.get("/export-summary-pdf", async (req: Request, res: Response) => {
  try {
    const { status, from, to } = req.query as { status?: string; from?: string; to?: string };

    // Build date-range conditions
    const conditions: ReturnType<typeof gte>[] = [];
    if (from) {
      const d = new Date(from); d.setHours(0, 0, 0, 0);
      if (!isNaN(d.getTime())) conditions.push(gte(executionsTable.createdAt, d));
    }
    if (to) {
      const d = new Date(to); d.setHours(23, 59, 59, 999);
      if (!isNaN(d.getTime())) conditions.push(lte(executionsTable.createdAt, d));
    }
    if (status) conditions.push(eq(executionsTable.status, status as any));

    const tenantCondition = scoped(req, executionsTable.tenantId);
    const whereClause = conditions.length > 0 ? and(tenantCondition, ...conditions) : tenantCondition;

    // Fetch rows + tenant name in parallel
    const [rows, tenantRows] = await Promise.all([
      db.select().from(executionsTable).where(whereClause).orderBy(desc(executionsTable.createdAt)),
      db.select({ name: tenantsTable.name }).from(tenantsTable).where(eq(tenantsTable.id, req.auth!.tenantId)).limit(1),
    ]);

    const firmName = tenantRows[0]?.name ?? "مكتب محاماة";

    // Fetch transfer order counts for all returned executions
    const counts: Record<number, number> = {};
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const countRows = await db
        .select({ executionId: transferOrderLogsTable.executionId, count: sql<number>`cast(count(*) as int)` })
        .from(transferOrderLogsTable)
        .where(inArray(transferOrderLogsTable.executionId, ids))
        .groupBy(transferOrderLogsTable.executionId);
      for (const cr of countRows) counts[cr.executionId] = cr.count;
    }

    const activeCount = rows.filter(r => r.status === "ACTIVE").length;
    const totalTransferOrders = Object.values(counts).reduce((s, c) => s + c, 0);
    const activeTransferOrders = rows
      .filter(r => r.status === "ACTIVE")
      .reduce((s, r) => s + (counts[r.id] ?? 0), 0);
    const avgPerActive = activeCount > 0
      ? Math.round((activeTransferOrders / activeCount) * 10) / 10
      : null;

    const now = new Date();
    const exportDate = now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
    const dateRangeStr = from && to
      ? `${from} ← ${to}`
      : from ? `من ${from}` : to ? `إلى ${to}` : "جميع السجلات";

    const html = buildSummaryPdfHtml({
      firmName,
      exportDate,
      dateRangeStr,
      totalCount: rows.length,
      activeCount,
      avgPerActive,
      totalTransferOrders,
      rows,
    });

    let browser = null;
    try {
      browser = await puppeteer.launch({
        executablePath: resolveChromiumPath(),
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
      await page.evaluateHandle("document.fonts.ready");
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "16px", bottom: "16px", left: "0", right: "0" },
      });

      let filename = "execution-summary";
      if (status) filename += `-${status}`;
      if (from && to) filename += `-${from}_${to}`;
      else if (from) filename += `-from-${from}`;
      else if (to) filename += `-to-${to}`;
      filename += ".pdf";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(pdfBuffer));
    } finally {
      if (browser) await (browser as any).close().catch(() => {});
    }
  } catch (err) {
    logger.error({ err }, "export summary PDF error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Count executions with payments for preview before export ─────────────────
router.get("/payments/count", async (req: Request, res: Response) => {
  try {
    const { from, to, status } = req.query as { from?: string; to?: string; status?: string };

    const conditions: ReturnType<typeof gte>[] = [];
    // Only executions that have at least one recorded payment
    conditions.push(sql`${executionsTable.lastWithdrawalAt} IS NOT NULL` as any);

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        conditions.push(gte(executionsTable.lastWithdrawalAt, fromDate) as any);
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(executionsTable.lastWithdrawalAt, toDate) as any);
      }
    }
    if (status) {
      conditions.push(eq(executionsTable.status, status as any));
    }

    const tenantCondition = scoped(req, executionsTable.tenantId);
    const whereClause = and(tenantCondition, ...conditions);

    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(executionsTable)
      .where(whereClause);

    res.json({ count: result?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "count payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Export executions with payments as Excel ──────────────────────────────────
router.get("/payments/export-excel", async (req: Request, res: Response) => {
  try {
    const { from, to, status } = req.query as { from?: string; to?: string; status?: string };

    const conditions: ReturnType<typeof gte>[] = [];
    conditions.push(sql`${executionsTable.lastWithdrawalAt} IS NOT NULL` as any);

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        conditions.push(gte(executionsTable.lastWithdrawalAt, fromDate) as any);
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(executionsTable.lastWithdrawalAt, toDate) as any);
      }
    }
    if (status) {
      conditions.push(eq(executionsTable.status, status as any));
    }

    const tenantCondition = scoped(req, executionsTable.tenantId);
    const whereClause = and(tenantCondition, ...conditions);

    const rows = await db
      .select()
      .from(executionsTable)
      .where(whereClause)
      .orderBy(desc(executionsTable.lastWithdrawalAt));

    const STATUS_AR: Record<string, string> = {
      ACTIVE: "نشط",
      FULL_PAYMENT: "سداد كامل",
      PARTIAL_PAYMENT: "سداد جزئي",
      SETTLEMENT: "تسوية",
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Law Firm ERP";
    const sheet = workbook.addWorksheet("المدفوعات", { views: [{ rightToLeft: true }] });

    sheet.columns = [
      { key: "executionNumber", width: 22 },
      { key: "totalAmount",     width: 18 },
      { key: "paidAmount",      width: 18 },
      { key: "remainingAmount", width: 18 },
      { key: "status",          width: 16 },
      { key: "lastWithdrawalAt", width: 26 },
      { key: "lastWithdrawalBy", width: 26 },
    ];

    // ── Metadata rows ─────────────────────────────────────────────────────────
    const now = new Date();
    const exportDateStr = now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
    const dateRangeStr = from && to
      ? `${from} ← ${to}`
      : from
        ? `من ${from}`
        : to
          ? `إلى ${to}`
          : "جميع السجلات";

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
      "رقم التنفيذ", "المبلغ الإجمالي", "المبلغ المسدَّد", "المتبقي",
      "الحالة", "تاريخ آخر سحب", "بواسطة",
    ]);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
    headerRow.height = 22;
    const headerRowNum = headerRow.number;
    sheet.views = [{ state: "frozen", ySplit: headerRowNum, rightToLeft: true }];

    for (const r of rows) {
      sheet.addRow({
        executionNumber: r.executionNumber || String(r.id),
        totalAmount: parseFloat(r.totalAmount),
        paidAmount: parseFloat(r.paidAmount),
        remainingAmount: parseFloat(r.remainingAmount),
        status: STATUS_AR[r.status] ?? r.status,
        lastWithdrawalAt: r.lastWithdrawalAt
          ? r.lastWithdrawalAt.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
          : "—",
        lastWithdrawalBy: r.lastWithdrawalBy || "—",
      });
    }

    sheet.eachRow((row, rowNum) => {
      if (rowNum <= headerRowNum) return;
      row.alignment = { readingOrder: "rtl", vertical: "middle" };
      if ((rowNum - headerRowNum) % 2 === 0) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
      }
    });

    let filename = "payments";
    if (status) filename += `-${status}`;
    if (from && to) filename += `-${from}_${to}`;
    else if (from) filename += `-from-${from}`;
    else if (to) filename += `-to-${to}`;
    filename += ".xlsx";

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error({ err }, "export payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/transfer-order-summary", async (req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
    const allRows = await db.select().from(executionsTable)
      .where(scoped(req, executionsTable.tenantId));
    const pendingCount = allRows.filter((e) => {
      if (e.status === "FULL_PAYMENT" || e.status === "SETTLEMENT") return false;
      if (!e.lastTransferOrderAt) return true;
      return e.lastTransferOrderAt < sevenDaysAgo;
    }).length;
    res.json({ pendingCount });
  } catch (err) {
    logger.error({ err }, "transfer order summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const [e] = await db.select().from(executionsTable)
      .where(scoped(req, executionsTable.tenantId, eq(executionsTable.id, id))).limit(1);
    if (!e) { res.status(404).json({ error: "Execution not found" }); return; }
    res.json(toExecutionJson(e));
  } catch (err) {
    logger.error({ err }, "get execution error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const { executionNumber, type, totalAmount, paidAmount, status } = req.body as {
      executionNumber?: string; type?: string; totalAmount?: number; paidAmount?: number; status?: string;
    };

    // Auto-calculate remaining when payment values change
    const updateData: Record<string, any> = {};
    if (executionNumber !== undefined) updateData.executionNumber = executionNumber;
    if (type !== undefined) updateData.type = type;
    if (status) updateData.status = status;

    if (totalAmount !== undefined || paidAmount !== undefined) {
      // Fetch current values to compute remaining
      const [current] = await db.select().from(executionsTable)
        .where(scoped(req, executionsTable.tenantId, eq(executionsTable.id, id))).limit(1);
      if (!current) { res.status(404).json({ error: "Execution not found" }); return; }
      const newTotal = totalAmount !== undefined ? totalAmount : parseFloat(current.totalAmount);
      const newPaid = paidAmount !== undefined ? paidAmount : parseFloat(current.paidAmount);
      const newRemaining = newTotal - newPaid;
      updateData.totalAmount = newTotal.toString();
      updateData.paidAmount = newPaid.toString();
      updateData.remainingAmount = newRemaining.toString();
      // Record withdrawal timestamp + who made it whenever paidAmount increases
      if (paidAmount !== undefined && paidAmount > parseFloat(current.paidAmount)) {
        updateData.lastWithdrawalAt = new Date();
        updateData.lastWithdrawalBy = await getWithdrawalBy(req.auth!.userId, req.auth!.role);
      }
    }

    const [updated] = await db.update(executionsTable).set(updateData)
      .where(scoped(req, executionsTable.tenantId, eq(executionsTable.id, id))).returning();
    if (!updated) { res.status(404).json({ error: "Execution not found" }); return; }
    res.json(toExecutionJson(updated));
  } catch (err) {
    logger.error({ err }, "update execution error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    await db.delete(executionsTable).where(scoped(req, executionsTable.tenantId, eq(executionsTable.id, id)));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "delete execution error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Record transfer order for this week ──────────────────────────────────────
router.post("/:id/transfer-order", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const tenantId = tenantStamp(req);
    const createdBy = await getWithdrawalBy(req.auth!.userId, req.auth!.role);

    // Atomic: stamp execution + append audit log in a single transaction
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(executionsTable)
        .set({ lastTransferOrderAt: new Date() })
        .where(scoped(req, executionsTable.tenantId, eq(executionsTable.id, id)))
        .returning();
      if (!updated) return null;
      await tx.insert(transferOrderLogsTable).values({ executionId: id, tenantId, createdBy });
      return updated;
    });

    if (!result) { res.status(404).json({ error: "Execution not found" }); return; }
    res.json(toExecutionJson(result));
  } catch (err) {
    logger.error({ err }, "record transfer order error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── List transfer-order log for a single execution ───────────────────────────
router.get("/:id/transfer-order-logs", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    // Verify the execution belongs to this tenant
    const [exe] = await db.select({ id: executionsTable.id }).from(executionsTable)
      .where(scoped(req, executionsTable.tenantId, eq(executionsTable.id, id))).limit(1);
    if (!exe) { res.status(404).json({ error: "Execution not found" }); return; }

    const logs = await db.select().from(transferOrderLogsTable)
      .where(eq(transferOrderLogsTable.executionId, id))
      .orderBy(desc(transferOrderLogsTable.createdAt));

    res.json(logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "list transfer order logs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
