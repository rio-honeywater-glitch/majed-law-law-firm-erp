import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  casesTable,
  hearingsTable,
  executionsTable,
  notificationsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, count, and, gte, lte, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped } from "../lib/tenant";
import { logger } from "../lib/logger";

const router = Router();

router.use(requireAuth);

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const [[{ totalClients }], [{ totalCases }], [{ activeCases }], [{ wonCases }], [{ lostCases }], [{ activeExecutions }], [{ pendingNotifications }]] = await Promise.all([
      db.select({ totalClients: count() }).from(clientsTable).where(scoped(req, clientsTable.tenantId)),
      db.select({ totalCases: count() }).from(casesTable).where(scoped(req, casesTable.tenantId)),
      db.select({ activeCases: count() }).from(casesTable).where(scoped(req, casesTable.tenantId, ne(casesTable.status, "CLOSED"))),
      db.select({ wonCases: count() }).from(casesTable).where(scoped(req, casesTable.tenantId, eq(casesTable.outcome, "WON"))),
      db.select({ lostCases: count() }).from(casesTable).where(scoped(req, casesTable.tenantId, eq(casesTable.outcome, "LOST"))),
      db.select({ activeExecutions: count() }).from(executionsTable).where(scoped(req, executionsTable.tenantId, eq(executionsTable.status, "ACTIVE"))),
      db.select({ pendingNotifications: count() }).from(notificationsTable).where(scoped(req, notificationsTable.tenantId, eq(notificationsTable.isRead, false))),
    ]);

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [{ upcomingHearingsCount }] = await db
      .select({ upcomingHearingsCount: count() })
      .from(hearingsTable)
      .where(scoped(req, hearingsTable.tenantId, and(gte(hearingsTable.utcDate, now), lte(hearingsTable.utcDate, sevenDaysLater))));

    res.json({
      totalClients,
      totalCases,
      activeCases,
      wonCases,
      lostCases,
      upcomingHearingsCount,
      activeExecutions,
      pendingNotifications,
    });
  } catch (err) {
    logger.error({ err }, "dashboard summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/upcoming-hearings", async (req: Request, res: Response) => {
  try {
    const daysRaw = parseInt(String(req.query["days"] ?? "7"), 10);
    const days = [7, 30, 60].includes(daysRaw) ? daysRaw : 7;
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: hearingsTable.id,
        caseId: hearingsTable.caseId,
        hijriDate: hearingsTable.hijriDate,
        utcDate: hearingsTable.utcDate,
        attendance: hearingsTable.attendance,
        requiresLawsuitEditing: hearingsTable.requiresLawsuitEditing,
        caseNumber: casesTable.caseNumber,
        clientName: clientsTable.name,
      })
      .from(hearingsTable)
      .leftJoin(casesTable, eq(hearingsTable.caseId, casesTable.id))
      .leftJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
      .where(scoped(req, hearingsTable.tenantId, and(gte(hearingsTable.utcDate, now), lte(hearingsTable.utcDate, sevenDaysLater))))
      .orderBy(hearingsTable.utcDate)
      .limit(20);

    res.json(rows.map(r => ({ ...r, utcDate: r.utcDate.toISOString() })));
  } catch (err) {
    logger.error({ err }, "upcoming hearings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/recent-activity", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(activityLogTable)
      .where(scoped(req, activityLogTable.tenantId))
      .orderBy(activityLogTable.createdAt)
      .limit(20);
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "recent activity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/case-status-breakdown", async (req: Request, res: Response) => {
  try {
    const [underReview, execution, closed] = await Promise.all([
      db.select({ c: count() }).from(casesTable).where(scoped(req, casesTable.tenantId, eq(casesTable.status, "UNDER_REVIEW"))),
      db.select({ c: count() }).from(casesTable).where(scoped(req, casesTable.tenantId, eq(casesTable.status, "EXECUTION"))),
      db.select({ c: count() }).from(casesTable).where(scoped(req, casesTable.tenantId, eq(casesTable.status, "CLOSED"))),
    ]);
    res.json({
      underReview: underReview[0]?.c ?? 0,
      execution: execution[0]?.c ?? 0,
      closed: closed[0]?.c ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "case status breakdown error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
