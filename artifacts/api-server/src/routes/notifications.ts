import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable, usersTable, pushFailedNotificationsTable } from "@workspace/db";
import { eq, isNull, or, and, gt, sql, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped } from "../lib/tenant";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

/**
 * Notifications visibility rule:
 * - userId IS NULL  → broadcast (hearings, executions) — visible to all tenant users
 * - userId = me     → addressed to this specific user (meeting invites/reminders)
 */
function visibleToMe(req: Request) {
  const uid = req.auth!.userId;
  return or(isNull(notificationsTable.userId), eq(notificationsTable.userId, uid))!;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(notificationsTable)
      .where(scoped(req, notificationsTable.tenantId, visibleToMe(req)))
      .orderBy(notificationsTable.createdAt);
    res.json(rows.map(n => ({ ...n, createdAt: n.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "list notifications error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id/read", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const [updated] = await db.update(notificationsTable)
      .set({ isRead: true })
      .where(scoped(req, notificationsTable.tenantId,
        eq(notificationsTable.id, id),
        visibleToMe(req),
      ))
      .returning();
    if (!updated) { res.status(404).json({ error: "Notification not found" }); return; }
    res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "mark notification read error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/read-all", async (req: Request, res: Response) => {
  try {
    await db.update(notificationsTable).set({ isRead: true })
      .where(scoped(req, notificationsTable.tenantId, visibleToMe(req)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "mark all notifications read error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /notifications/missed
 *
 * Returns unread notifications that arrived since the user's last acknowledged
 * checkpoint (lastMissedAckAt), alongside a stable acknowledgement cursor.
 *
 * Response: { items: Notification[], cursor: string }
 *   - `items`: unread notifications created after lastMissedAckAt (or all unread
 *              if no checkpoint exists yet — handles first session / null checkpoint
 *              safely without discarding anything)
 *   - `cursor`: ISO timestamp snapshot taken at the start of this request. The
 *              client must pass this back to POST /notifications/missed/acknowledge.
 *              Because the cursor is fixed at GET time, any notification that
 *              arrives after GET returns but before the user dismisses the banner
 *              is NOT covered — it will appear in the next session's GET call.
 *
 * This endpoint does NOT modify lastMissedAckAt. The checkpoint only advances
 * through explicit client acknowledgement, so dropped / aborted requests never
 * silently skip notifications.
 */
router.get("/missed", async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;

    // Snapshot the server time once, before the query — this is the cursor
    // the client will send back to acknowledge. Stable regardless of DB latency.
    const snapshotAt = new Date();

    const [user] = await db
      .select({ lastMissedAckAt: usersTable.lastMissedAckAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const lastMissedAckAt = user?.lastMissedAckAt ?? null;

    // Build the where condition:
    //  - If no checkpoint (null): return all current unread notifications.
    //    This is correct for new users and existing users after migration —
    //    nothing is silently discarded.
    //  - If checkpoint exists: return unread notifications created after it.
    const timeFilter = lastMissedAckAt
      ? gt(notificationsTable.createdAt, lastMissedAckAt)
      : undefined;

    const missed = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          scoped(req, notificationsTable.tenantId, visibleToMe(req)),
          eq(notificationsTable.isRead, false),
          ...(timeFilter ? [timeFilter] : []),
        ),
      )
      .orderBy(notificationsTable.createdAt);

    res.json({
      items: missed.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
      cursor: snapshotAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "missed notifications error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /notifications/missed/acknowledge
 *
 * Advances the user's lastMissedAckAt checkpoint to the cursor value returned
 * by GET /notifications/missed. The client must pass back the exact cursor
 * received — not server now — so the checkpoint captures exactly the snapshot
 * window from that GET call.
 *
 * Monotonically advancing: only updates if the provided cursor is later than
 * the current checkpoint, making concurrent / retry calls safe.
 *
 * Body: { cursor: string }  (ISO timestamp from GET response)
 */
router.post("/missed/acknowledge", async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const { cursor } = req.body as { cursor?: string };

    if (!cursor) {
      res.status(400).json({ error: "cursor is required" });
      return;
    }

    const cursorDate = new Date(cursor);
    if (isNaN(cursorDate.getTime())) {
      res.status(400).json({ error: "cursor must be a valid ISO timestamp" });
      return;
    }

    // Only advance if the new cursor is strictly later than the current checkpoint.
    // This makes the operation idempotent and safe under concurrent requests / retries.
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: cursorDate })
      .where(
        and(
          eq(usersTable.id, userId),
          or(
            isNull(usersTable.lastMissedAckAt),
            sql`${usersTable.lastMissedAckAt} < ${cursorDate}`,
          ),
        ),
      );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "missed-ack error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /notifications/missed-push
 *
 * Returns unacknowledged failed Expo push notification records for the
 * authenticated user. The mobile app calls this on startup to decide whether
 * to show the "missed notifications" banner.
 *
 * A record is considered unacknowledged when acknowledgedAt IS NULL.
 */
router.get("/missed-push", async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;

    const rows = await db
      .select()
      .from(pushFailedNotificationsTable)
      .where(
        and(
          eq(pushFailedNotificationsTable.userId, userId),
          isNull(pushFailedNotificationsTable.acknowledgedAt),
        ),
      )
      .orderBy(pushFailedNotificationsTable.failedAt);

    res.json({
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body ?? null,
        url: r.url ?? null,
        failureReason: r.failureReason ?? null,
        failedAt: r.failedAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "missed-push error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /notifications/missed-push/acknowledge
 *
 * Marks all unacknowledged missed-push records for the authenticated user as
 * acknowledged (sets acknowledgedAt = now). Called when the user dismisses the
 * "missed notifications" banner.
 */
router.post("/missed-push/acknowledge", async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;

    await db
      .update(pushFailedNotificationsTable)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(pushFailedNotificationsTable.userId, userId),
          isNull(pushFailedNotificationsTable.acknowledgedAt),
        ),
      );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "missed-push acknowledge error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
