import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { tenantStamp } from "../lib/tenant";
import { vapidPublicKey } from "../lib/push";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// GET /push/vapid-public-key — return public key for frontend subscription
router.get("/vapid-public-key", (_req: Request, res: Response) => {
  if (!vapidPublicKey) {
    res.status(503).json({ error: "Push notifications not configured" });
    return;
  }
  res.json({ vapidPublicKey });
});

// POST /push/subscribe — save a push subscription tied to the authenticated user
router.post("/subscribe", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const userId: number = req.auth!.userId;
    const { endpoint, keys } = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: "endpoint, keys.p256dh and keys.auth are required" });
      return;
    }
    // Upsert by endpoint — always associate with the authenticated user
    await db
      .insert(pushSubscriptionsTable)
      .values({ tenantId, userId: userId ?? null, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: { tenantId, userId: userId ?? null, p256dh: keys.p256dh, auth: keys.auth },
      });
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error({ err }, "push subscribe error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /push/subscribe — remove a push subscription
router.delete("/subscribe", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint) { res.status(400).json({ error: "endpoint required" }); return; }
    await db
      .delete(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.endpoint, endpoint), eq(pushSubscriptionsTable.tenantId, tenantId)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "push unsubscribe error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /push/expo-token — register an Expo push token for native mobile notifications
router.post("/expo-token", async (req: Request, res: Response) => {
  try {
    const tenantId = tenantStamp(req);
    const userId: number = req.auth!.userId;
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    // Store Expo push token using the token string as the endpoint key.
    // p256dh and auth are unused for Expo tokens but required by the schema.
    await db
      .insert(pushSubscriptionsTable)
      .values({ tenantId, userId, endpoint: token, p256dh: "", auth: "" })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: { tenantId, userId },
      });
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error({ err }, "expo push token register error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

