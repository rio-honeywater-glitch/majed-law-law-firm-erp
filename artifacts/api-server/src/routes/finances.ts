import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  expensesTable, expensePaymentsTable, contractPaymentsTable,
  contractsTable, clientsTable, notificationsTable, usersTable, casesTable,
} from "@workspace/db";
import { eq, desc, sql, and, gte, lte, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireSystemManager } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import ExcelJS from "exceljs";

const router = Router();
router.use(requireAuth);
router.use(requireSystemManager);

// ─── Period helper ───────────────────────────────────────────────────────────
function parsePeriod(
  period?: string, fromStr?: string, toStr?: string
): { from: Date | null; to: Date | null } {
  const now = new Date();
  switch (period) {
    case "today": {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const e = new Date(s.getTime() + 86_400_000 - 1);
      return { from: s, to: e };
    }
    case "week": {
      return { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: s, to: now };
    }
    case "custom": {
      return {
        from: fromStr ? new Date(fromStr) : null,
        to: toStr ? new Date(toStr) : null,
      };
    }
    default:
      return { from: null, to: null }; // all time
  }
}

function addDateFilter<T extends { createdAt: any }>(
  table: T,
  from: Date | null,
  to: Date | null
) {
  const conditions = [];
  if (from) conditions.push(gte(table.createdAt, from));
  if (to)   conditions.push(lte(table.createdAt, to));
  return conditions;
}

// ─── Stats ───────────────────────────────────────────────────────────────────
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { period, from, to } = req.query as Record<string, string | undefined>;
    const { from: fromDate, to: toDate } = parsePeriod(period, from, to);
    const tenantId = req.auth!.tenantId;

    // Revenue: total fees from contracts (created in period)
    const revenueFilter = [
      eq(contractsTable.tenantId, tenantId),
      ...(fromDate ? [gte(contractsTable.createdAt, fromDate)] : []),
      ...(toDate   ? [lte(contractsTable.createdAt, toDate)]   : []),
    ];
    const [revenueRow] = await db
      .select({ total: sql<string>`coalesce(sum(${contractsTable.fees}::numeric), 0)` })
      .from(contractsTable)
      .where(and(...revenueFilter));
    const totalRevenue = parseFloat(revenueRow?.total ?? "0");

    // Paid revenue: sum of paid contract_payments
    const [paidRevenueRow] = await db
      .select({ total: sql<string>`coalesce(sum(${contractPaymentsTable.amount}), 0)` })
      .from(contractPaymentsTable)
      .where(and(
        eq(contractPaymentsTable.tenantId, tenantId),
        eq(contractPaymentsTable.isPaid, true),
        ...(fromDate ? [gte(contractPaymentsTable.paidAt, fromDate)] : []),
        ...(toDate   ? [lte(contractPaymentsTable.paidAt, toDate)]   : []),
      ));
    const paidRevenue = parseFloat(paidRevenueRow?.total ?? "0");

    // Expenses: total amount from expenses (created in period)
    const expFilter = [
      eq(expensesTable.tenantId, tenantId),
      ...(fromDate ? [gte(expensesTable.createdAt, fromDate)] : []),
      ...(toDate   ? [lte(expensesTable.createdAt, toDate)]   : []),
    ];
    const [expRow] = await db
      .select({ total: sql<string>`coalesce(sum(${expensesTable.totalAmount}), 0)` })
      .from(expensesTable)
      .where(and(...expFilter));
    const totalExpenses = parseFloat(expRow?.total ?? "0");

    // Monthly chart: last 12 months using contract created_at and fees
    const monthlyRevenue = await db.execute(sql`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM') AS month,
        SUM(fees::numeric)::numeric AS total
      FROM contracts
      WHERE tenant_id = ${tenantId}
        AND fees IS NOT NULL
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `);

    // Monthly expenses: last 12 months
    const monthlyExpenses = await db.execute(sql`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM') AS month,
        SUM(total_amount)::numeric AS total
      FROM expenses
      WHERE tenant_id = ${tenantId}
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `);

    res.json({
      totalRevenue,
      paidRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      monthlyRevenue: monthlyRevenue.rows.map((r: any) => ({ month: r.month, total: parseFloat(r.total) })),
      monthlyExpenses: monthlyExpenses.rows.map((r: any) => ({ month: r.month, total: parseFloat(r.total) })),
    });
  } catch (err) {
    logger.error({ err }, "finance stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Sales (contract fees) ───────────────────────────────────────────────────
router.get("/sales", async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const { period, from, to } = req.query as Record<string, string | undefined>;
    const { from: fromDate, to: toDate } = parsePeriod(period, from, to);

    const dateConditions = addDateFilter(contractsTable, fromDate, toDate);
    const contracts = await db
      .select({
        id: contractsTable.id,
        caseNumber: contractsTable.caseNumber,
        caseSubject: contractsTable.caseSubject,
        fees: contractsTable.fees,
        clientId: contractsTable.clientId,
        clientName: clientsTable.name,
        createdAt: contractsTable.createdAt,
        caseId: casesTable.id,
      })
      .from(contractsTable)
      .leftJoin(clientsTable, eq(contractsTable.clientId, clientsTable.id))
      .leftJoin(
        casesTable,
        and(
          eq(casesTable.tenantId, contractsTable.tenantId),
          eq(casesTable.caseNumber, contractsTable.caseNumber)
        )
      )
      .where(and(eq(contractsTable.tenantId, tenantId), ...dateConditions))
      .orderBy(desc(contractsTable.createdAt));

    if (contracts.length === 0) {
      res.json([]);
      return;
    }

    const contractIds = contracts.map(c => c.id);
    const payments = await db
      .select({
        contractId: contractPaymentsTable.contractId,
        paid: sql<string>`coalesce(sum(case when is_paid then amount else 0 end), 0)`,
        total: sql<string>`coalesce(sum(amount), 0)`,
      })
      .from(contractPaymentsTable)
      .where(
        and(
          eq(contractPaymentsTable.tenantId, tenantId),
          inArray(contractPaymentsTable.contractId, contractIds)
        )
      )
      .groupBy(contractPaymentsTable.contractId);

    const payMap = new Map(payments.map(p => [p.contractId, p]));

    const rows = contracts.map(c => {
      const p = payMap.get(c.id);
      const fees = parseFloat(c.fees ?? "0");
      const paid = parseFloat(p?.paid ?? "0");
      return {
        contractId: c.id,
        caseId: c.caseId ?? null,
        caseNumber: c.caseNumber ?? "-",
        caseSubject: c.caseSubject ?? "-",
        clientName: c.clientName ?? "-",
        totalFees: fees,
        paidAmount: paid,
        remainingAmount: fees - paid,
        createdAt: c.createdAt.toISOString(),
      };
    });

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "finance sales error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Contract payments (for case financial summary) ──────────────────────────
router.get("/contract-payments", async (req: Request, res: Response) => {
  try {
    const { contractId } = req.query as { contractId?: string };
    const tenantId = req.auth!.tenantId;
    const conditions: any[] = [eq(contractPaymentsTable.tenantId, tenantId)];
    if (contractId) conditions.push(eq(contractPaymentsTable.contractId, parseInt(contractId, 10)));
    const rows = await db
      .select()
      .from(contractPaymentsTable)
      .where(and(...conditions))
      .orderBy(contractPaymentsTable.dueDate);
    res.json(rows.map(r => ({ ...r, paidAt: r.paidAt?.toISOString() ?? null })));
  } catch (err) {
    logger.error({ err }, "list contract payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contract-payments", async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const { contractId, description, amount, dueDate, notes } = req.body;
    if (!contractId || !description || !amount) {
      res.status(400).json({ error: "contractId, description, and amount are required" });
      return;
    }
    const [row] = await db.insert(contractPaymentsTable).values({
      tenantId,
      contractId: parseInt(contractId, 10),
      description,
      amount: String(amount),
      dueDate: dueDate || null,
      notes: notes || null,
      isPaid: false,
    }).returning();
    res.status(201).json({ ...row, paidAt: null });
  } catch (err) {
    logger.error({ err }, "create contract payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/contract-payments/:id/pay", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const tenantId = req.auth!.tenantId;
    const [row] = await db
      .update(contractPaymentsTable)
      .set({ isPaid: true, paidAt: new Date() })
      .where(and(eq(contractPaymentsTable.id, id), eq(contractPaymentsTable.tenantId, tenantId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Payment not found" }); return; }
    res.json({ ...row, paidAt: row.paidAt?.toISOString() ?? null });
  } catch (err) {
    logger.error({ err }, "pay contract payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/contract-payments/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const tenantId = req.auth!.tenantId;
    await db.delete(contractPaymentsTable)
      .where(and(eq(contractPaymentsTable.id, id), eq(contractPaymentsTable.tenantId, tenantId)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "delete contract payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Expenses ────────────────────────────────────────────────────────────────

function generatePaymentSchedule(
  tenantId: number,
  expenseId: number,
  totalAmount: number,
  installmentsCount: number,
  paymentDurationMonths: number | null,
  singleDueDate: string | null
): { tenantId: number; expenseId: number; installmentNumber: number; amount: string; dueDate: string }[] {
  const installmentAmount = totalAmount / installmentsCount;
  const payments = [];
  const startDate = new Date();

  for (let i = 1; i <= installmentsCount; i++) {
    let dueDate: string;
    if (installmentsCount === 1 && singleDueDate) {
      dueDate = singleDueDate;
    } else {
      // Spread evenly over duration
      const intervalMonths = paymentDurationMonths
        ? paymentDurationMonths / installmentsCount
        : 1;
      const d = new Date(startDate);
      const totalMonths = Math.round(intervalMonths * i);
      d.setMonth(d.getMonth() + totalMonths);
      dueDate = d.toISOString().slice(0, 10);
    }
    payments.push({
      tenantId,
      expenseId,
      installmentNumber: i,
      amount: installmentAmount.toFixed(2),
      dueDate,
    });
  }
  return payments;
}

router.get("/expenses", async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const { period, from, to } = req.query as Record<string, string | undefined>;
    const { from: fromDate, to: toDate } = parsePeriod(period, from, to);
    const dateConditions = addDateFilter(expensesTable, fromDate, toDate);

    const expenses = await db
      .select({
        id: expensesTable.id,
        tenantId: expensesTable.tenantId,
        createdBy: expensesTable.createdBy,
        createdByName: usersTable.name,
        createdByRole: usersTable.role,
        expenseType: expensesTable.expenseType,
        totalAmount: expensesTable.totalAmount,
        installmentsCount: expensesTable.installmentsCount,
        paymentDurationMonths: expensesTable.paymentDurationMonths,
        singleDueDate: expensesTable.singleDueDate,
        notes: expensesTable.notes,
        createdAt: expensesTable.createdAt,
        updatedAt: expensesTable.updatedAt,
      })
      .from(expensesTable)
      .leftJoin(usersTable, eq(expensesTable.createdBy, usersTable.id))
      .where(and(eq(expensesTable.tenantId, tenantId), ...dateConditions))
      .orderBy(desc(expensesTable.createdAt));

    const expenseIds = expenses.map(e => e.id);
    let paymentsMap = new Map<number, any[]>();
    if (expenseIds.length > 0) {
      const payments = await db
        .select()
        .from(expensePaymentsTable)
        .where(
          and(
            eq(expensePaymentsTable.tenantId, tenantId),
            inArray(expensePaymentsTable.expenseId, expenseIds)
          )
        )
        .orderBy(expensePaymentsTable.installmentNumber);
      for (const p of payments) {
        if (!paymentsMap.has(p.expenseId)) paymentsMap.set(p.expenseId, []);
        paymentsMap.get(p.expenseId)!.push({
          ...p,
          amount: parseFloat(p.amount),
          paidAt: p.paidAt?.toISOString() ?? null,
        });
      }
    }

    res.json(expenses.map(e => ({
      ...e,
      totalAmount: parseFloat(e.totalAmount),
      createdAt: e.createdAt.toISOString(),
      payments: paymentsMap.get(e.id) ?? [],
    })));
  } catch (err) {
    logger.error({ err }, "list expenses error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/expenses", async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const { expenseType, totalAmount, installmentsCount, paymentDurationMonths, singleDueDate, notes, installments } = req.body;
    if (!expenseType || !totalAmount) {
      res.status(400).json({ error: "expenseType and totalAmount are required" });
      return;
    }
    const count = parseInt(installmentsCount ?? "1", 10);
    const total = parseFloat(totalAmount);

    const [expense] = await db.insert(expensesTable).values({
      tenantId,
      createdBy: req.auth!.userId,
      expenseType,
      totalAmount: String(total),
      installmentsCount: count,
      paymentDurationMonths: count > 1 ? (parseInt(paymentDurationMonths ?? "0", 10) || null) : null,
      singleDueDate: count === 1 ? (singleDueDate || null) : null,
      notes: notes || null,
    }).returning();

    // Use custom installments if provided, otherwise auto-generate
    let schedule: { tenantId: number; expenseId: number; installmentNumber: number; amount: string; dueDate: string }[];
    if (Array.isArray(installments) && installments.length > 0) {
      schedule = installments.map((item: { installmentNumber: number; dueDate: string; amount: number }) => ({
        tenantId,
        expenseId: expense.id,
        installmentNumber: item.installmentNumber,
        amount: String(parseFloat(String(item.amount)).toFixed(2)),
        dueDate: item.dueDate,
      }));
    } else {
      schedule = generatePaymentSchedule(
        tenantId, expense.id, total, count,
        expense.paymentDurationMonths, expense.singleDueDate
      );
    }
    if (schedule.length > 0) {
      await db.insert(expensePaymentsTable).values(schedule);
    }

    const payments = await db
      .select()
      .from(expensePaymentsTable)
      .where(eq(expensePaymentsTable.expenseId, expense.id))
      .orderBy(expensePaymentsTable.installmentNumber);

    res.status(201).json({
      ...expense,
      totalAmount: parseFloat(expense.totalAmount),
      payments: payments.map(p => ({ ...p, amount: parseFloat(p.amount), paidAt: null })),
    });
  } catch (err) {
    logger.error({ err }, "create expense error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/expenses/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const tenantId = req.auth!.tenantId;
    const { expenseType, totalAmount, installmentsCount, paymentDurationMonths, singleDueDate, notes } = req.body;
    const count = parseInt(installmentsCount ?? "1", 10);
    const total = parseFloat(totalAmount);

    const [expense] = await db
      .update(expensesTable)
      .set({
        expenseType,
        totalAmount: String(total),
        installmentsCount: count,
        paymentDurationMonths: count > 1 ? (parseInt(paymentDurationMonths ?? "0", 10) || null) : null,
        singleDueDate: count === 1 ? (singleDueDate || null) : null,
        notes: notes || null,
        updatedAt: new Date(),
      })
      .where(and(eq(expensesTable.id, id), eq(expensesTable.tenantId, tenantId)))
      .returning();
    if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }

    // Rebuild payment schedule (delete unpaid, regenerate)
    await db.delete(expensePaymentsTable)
      .where(and(eq(expensePaymentsTable.expenseId, id), eq(expensePaymentsTable.isPaid, false)));

    const paidCount = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(expensePaymentsTable)
      .where(and(eq(expensePaymentsTable.expenseId, id), eq(expensePaymentsTable.isPaid, true)));
    const alreadyPaid = paidCount[0]?.count ?? 0;
    const remaining = count - alreadyPaid;

    if (remaining > 0) {
      const schedule = generatePaymentSchedule(
        tenantId, id, total, remaining,
        expense.paymentDurationMonths, expense.singleDueDate
      ).map((p, idx) => ({ ...p, installmentNumber: alreadyPaid + idx + 1 }));
      await db.insert(expensePaymentsTable).values(schedule);
    }

    const payments = await db
      .select()
      .from(expensePaymentsTable)
      .where(eq(expensePaymentsTable.expenseId, id))
      .orderBy(expensePaymentsTable.installmentNumber);

    res.json({
      ...expense,
      totalAmount: parseFloat(expense.totalAmount),
      payments: payments.map(p => ({ ...p, amount: parseFloat(p.amount), paidAt: p.paidAt?.toISOString() ?? null })),
    });
  } catch (err) {
    logger.error({ err }, "update expense error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/expenses/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const tenantId = req.auth!.tenantId;
    await db.delete(expensesTable)
      .where(and(eq(expensesTable.id, id), eq(expensesTable.tenantId, tenantId)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "delete expense error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/expenses/:expenseId/payments/:paymentId/pay", async (req: Request, res: Response) => {
  try {
    const paymentId = parseInt(req.params["paymentId"] as string, 10);
    const tenantId = req.auth!.tenantId;
    const [row] = await db
      .update(expensePaymentsTable)
      .set({ isPaid: true, paidAt: new Date() })
      .where(and(eq(expensePaymentsTable.id, paymentId), eq(expensePaymentsTable.tenantId, tenantId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Payment not found" }); return; }
    res.json({ ...row, amount: parseFloat(row.amount), paidAt: row.paidAt?.toISOString() ?? null });
  } catch (err) {
    logger.error({ err }, "pay expense payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Export Expenses to Excel ────────────────────────────────────────────────
router.get("/expenses/export/excel", async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const expenses = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.tenantId, tenantId))
      .orderBy(desc(expensesTable.createdAt));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("المصروفات", { views: [{ rightToLeft: true }] });
    ws.columns = [
      { header: "#", key: "id", width: 6 },
      { header: "نوع المصروف", key: "expenseType", width: 25 },
      { header: "الإجمالي", key: "totalAmount", width: 16 },
      { header: "عدد الدفعات", key: "installmentsCount", width: 14 },
      { header: "مدة السداد (شهر)", key: "paymentDurationMonths", width: 18 },
      { header: "تاريخ الاستحقاق (دفعة واحدة)", key: "singleDueDate", width: 28 },
      { header: "ملاحظات", key: "notes", width: 30 },
      { header: "تاريخ التسجيل", key: "createdAt", width: 22 },
    ];

    let idx = 1;
    for (const e of expenses) {
      ws.addRow({
        id: idx++,
        expenseType: e.expenseType,
        totalAmount: parseFloat(e.totalAmount),
        installmentsCount: e.installmentsCount,
        paymentDurationMonths: e.paymentDurationMonths ?? "",
        singleDueDate: e.singleDueDate ?? "",
        notes: e.notes ?? "",
        createdAt: e.createdAt.toLocaleDateString("ar-SA"),
      });
    }

    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Disposition", `attachment; filename="expenses.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  } catch (err) {
    logger.error({ err }, "export expenses excel error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Notification scheduler (called externally) ──────────────────────────────
export async function runFinanceNotificationCheck() {
  try {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    const todayStr = new Date().toISOString().slice(0, 10);
    const soonStr = soon.toISOString().slice(0, 10);

    // Find all tenants with upcoming expense payments
    const upcomingExpense = await db
      .select({
        tenantId: expensePaymentsTable.tenantId,
        paymentId: expensePaymentsTable.id,
        dueDate: expensePaymentsTable.dueDate,
        amount: expensePaymentsTable.amount,
        installmentNumber: expensePaymentsTable.installmentNumber,
        expenseType: expensesTable.expenseType,
      })
      .from(expensePaymentsTable)
      .innerJoin(expensesTable, eq(expensePaymentsTable.expenseId, expensesTable.id))
      .where(
        and(
          eq(expensePaymentsTable.isPaid, false),
          gte(expensePaymentsTable.dueDate, todayStr),
          lte(expensePaymentsTable.dueDate, soonStr),
        )
      );

    for (const ep of upcomingExpense) {
      // Find SYSTEM_MANAGER users for this tenant
      const managers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, ep.tenantId), eq(usersTable.role, "SYSTEM_MANAGER")));

      for (const m of managers) {
        // Check if notification already sent today for this payment
        const existing = await db
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.tenantId, ep.tenantId),
              eq(notificationsTable.userId, m.id),
              eq(notificationsTable.relatedEntityId, ep.paymentId),
              eq(notificationsTable.relatedEntityType, "expense_payment"),
              gte(notificationsTable.createdAt, new Date(new Date().setHours(0, 0, 0, 0))),
            )
          )
          .limit(1);
        if (existing.length > 0) continue;

        await db.insert(notificationsTable).values({
          tenantId: ep.tenantId,
          userId: m.id,
          type: "GENERAL",
          message: `تذكير: دفعة مصروف "${ep.expenseType}" رقم ${ep.installmentNumber} بمبلغ ${parseFloat(ep.amount).toLocaleString("ar-SA")} ر.س تستحق بتاريخ ${ep.dueDate}`,
          relatedEntityId: ep.paymentId,
          relatedEntityType: "expense_payment",
          isRead: false,
        });
      }
    }

    // Upcoming contract payments
    const upcomingContract = await db
      .select({
        tenantId: contractPaymentsTable.tenantId,
        paymentId: contractPaymentsTable.id,
        dueDate: contractPaymentsTable.dueDate,
        amount: contractPaymentsTable.amount,
        description: contractPaymentsTable.description,
      })
      .from(contractPaymentsTable)
      .where(
        and(
          eq(contractPaymentsTable.isPaid, false),
          gte(contractPaymentsTable.dueDate, todayStr),
          lte(contractPaymentsTable.dueDate, soonStr),
        )
      );

    for (const cp of upcomingContract) {
      const managers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, cp.tenantId), eq(usersTable.role, "SYSTEM_MANAGER")));

      for (const m of managers) {
        const existing = await db
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.tenantId, cp.tenantId),
              eq(notificationsTable.userId, m.id),
              eq(notificationsTable.relatedEntityId, cp.paymentId),
              eq(notificationsTable.relatedEntityType, "contract_payment"),
              gte(notificationsTable.createdAt, new Date(new Date().setHours(0, 0, 0, 0))),
            )
          )
          .limit(1);
        if (existing.length > 0) continue;

        await db.insert(notificationsTable).values({
          tenantId: cp.tenantId,
          userId: m.id,
          type: "GENERAL",
          message: `تذكير: دفعة أتعاب "${cp.description}" بمبلغ ${parseFloat(cp.amount).toLocaleString("ar-SA")} ر.س تستحق بتاريخ ${cp.dueDate}`,
          relatedEntityId: cp.paymentId,
          relatedEntityType: "contract_payment",
          isRead: false,
        });
      }
    }

    logger.info("Finance notification check completed");
  } catch (err) {
    logger.error({ err }, "Finance notification check failed");
  }
}

export default router;
