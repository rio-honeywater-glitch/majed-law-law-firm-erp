import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { hearingsTable, activityLogTable, tasksTable, casesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import { sendPushToTenant } from "../lib/push";
import { isHearingStatus, serializeHearing } from "../lib/hearing-serialization";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  try {
    const { caseId } = req.query as { caseId?: string };
    const rows = await db
      .select()
      .from(hearingsTable)
      .where(scoped(req, hearingsTable.tenantId, caseId ? eq(hearingsTable.caseId, parseInt(caseId, 10)) : undefined))
      .orderBy(hearingsTable.utcDate);
    res.json(rows.map(serializeHearing));
  } catch (err) {
    logger.error({ err }, "list hearings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { caseId, hijriDate, utcDate, attendance, transcriptUrl, hearingReport, notes, requiresLawsuitEditing, requiresReplyPrep, sessionLink } = req.body as {
      caseId: number; hijriDate: string; utcDate: string; attendance?: string;
      transcriptUrl?: string; hearingReport?: string; notes?: string; requiresLawsuitEditing?: boolean; requiresReplyPrep?: boolean; sessionLink?: string;
    };
    const tenantId = tenantStamp(req);
    // Ensure the parent case belongs to the caller's firm.
    const [caseRow] = await db.select({ id: casesTable.id, caseNumber: casesTable.caseNumber }).from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, caseId))).limit(1);
    if (!caseRow) { res.status(400).json({ error: "Case not found" }); return; }

    const [hearing] = await db.insert(hearingsTable).values({
      tenantId,
      caseId,
      hijriDate,
      utcDate: new Date(utcDate),
      attendance,
      transcriptUrl,
      hearingReport,
      notes,
      sessionLink,
      requiresLawsuitEditing: requiresLawsuitEditing ?? true,
      requiresReplyPrep: requiresReplyPrep ?? false,
    }).returning();

    await db.insert(activityLogTable).values({
      tenantId,
      type: "HEARING_CREATED",
      description: `تم تسجيل جلسة جديدة بتاريخ: ${hijriDate}`,
      entityId: hearing.id,
      entityType: "hearing",
    });

    // Automation sync: create a team-wide task for the new hearing
    try {
      await db.insert(tasksTable).values({
        tenantId,
        title: caseRow.caseNumber
          ? `حضور جلسة — القضية رقم ${caseRow.caseNumber}`
          : `حضور جلسة بتاريخ ${hijriDate}`,
        description: `مهمة تلقائية: جلسة بتاريخ هجري ${hijriDate}`,
        taskType: "HEARING_AUTO",
        dueDate: hearing.utcDate,
        assignedById: req.auth!.userId,
        assignedToId: null, // team-wide: visible to everyone
        relatedHearingId: hearing.id,
        linkUrl: `/cases/${caseRow.id}?tab=hearings&hearing=${hearing.id}`,
      });
    } catch (taskErr) {
      req.log.error({ err: taskErr }, "failed to auto-create hearing task");
    }

    // Notify all tenant members about the new hearing
    const hearingMsg = caseRow.caseNumber
      ? `جلسة جديدة — القضية رقم ${caseRow.caseNumber} بتاريخ ${hijriDate}`
      : `جلسة جديدة بتاريخ ${hijriDate}`;
    sendPushToTenant(tenantId, {
      title: "جلسة جديدة",
      body: hearingMsg,
      url: `/cases/${caseId}?tab=hearings`,
    }).catch(() => {});

    res.status(201).json(serializeHearing(hearing));
  } catch (err) {
    logger.error({ err }, "create hearing error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const [h] = await db.select().from(hearingsTable)
      .where(scoped(req, hearingsTable.tenantId, eq(hearingsTable.id, id))).limit(1);
    if (!h) { res.status(404).json({ error: "Hearing not found" }); return; }
    res.json(serializeHearing(h));
  } catch (err) {
    logger.error({ err }, "get hearing error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const { hijriDate, utcDate, attendance, transcriptUrl, hearingReport, notes, requiresLawsuitEditing, requiresReplyPrep, sessionLink, status } = req.body as {
      hijriDate?: string; utcDate?: string; attendance?: string;
      transcriptUrl?: string; hearingReport?: string; notes?: string;
      requiresLawsuitEditing?: boolean; requiresReplyPrep?: boolean; sessionLink?: string;
      status?: unknown;
    };
    let normalizedStatus: string | null | undefined;
    if ("status" in req.body) {
      if (status !== null && !isHearingStatus(status)) {
        res.status(400).json({ error: "Invalid hearing status" });
        return;
      }
      normalizedStatus = status;
    }
    const [updated] = await db.update(hearingsTable).set({
      ...(hijriDate && { hijriDate }),
      ...(utcDate && { utcDate: new Date(utcDate) }),
      ...(attendance !== undefined && { attendance }),
      ...(transcriptUrl !== undefined && { transcriptUrl }),
      ...(hearingReport !== undefined && { hearingReport }),
      ...(notes !== undefined && { notes }),
      ...(requiresLawsuitEditing !== undefined && { requiresLawsuitEditing }),
      ...(requiresReplyPrep !== undefined && { requiresReplyPrep }),
      ...(sessionLink !== undefined && { sessionLink }),
      // status: null = auto-derive from date; explicit value = manual override
      ...("status" in req.body && { status: normalizedStatus ?? null }),
    }).where(scoped(req, hearingsTable.tenantId, eq(hearingsTable.id, id))).returning();
    if (!updated) { res.status(404).json({ error: "Hearing not found" }); return; }

    // Notify if the hearing date or time changed
    if (hijriDate || utcDate) {
      const tenantId = updated.tenantId;
      const [caseRow] = await db
        .select({ id: casesTable.id, caseNumber: casesTable.caseNumber })
        .from(casesTable)
        .where(scoped(req, casesTable.tenantId, eq(casesTable.id, updated.caseId)))
        .limit(1);
      const newDate = updated.hijriDate;
      const hearingMsg = caseRow?.caseNumber
        ? `تم تعديل موعد جلسة — القضية رقم ${caseRow.caseNumber} إلى ${newDate}`
        : `تم تعديل موعد جلسة إلى ${newDate}`;
      sendPushToTenant(tenantId, {
        title: "تعديل موعد جلسة",
        body: hearingMsg,
        url: `/cases/${updated.caseId}?tab=hearings`,
      }).catch(() => {});
    }

    res.json(serializeHearing(updated));
  } catch (err) {
    logger.error({ err }, "update hearing error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    await db.delete(hearingsTable).where(scoped(req, hearingsTable.tenantId, eq(hearingsTable.id, id)));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "delete hearing error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
