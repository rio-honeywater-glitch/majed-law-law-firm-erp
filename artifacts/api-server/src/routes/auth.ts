import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, signToken } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // Only firm-level roles are accepted after SUPER_ADMIN removal.
    if (user.role !== "SYSTEM_MANAGER" && user.role !== "TECHNICIAN") {
      res.status(403).json({ error: "دور المستخدم غير مدعوم." });
      return;
    }

    const [tenant] = await db
      .select({
        status: tenantsTable.status,
        name: tenantsTable.name,
        logoUrl: tenantsTable.logoUrl,
        primaryColor: tenantsTable.primaryColor,
        secondaryColor: tenantsTable.secondaryColor,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, user.tenantId))
      .limit(1);

    if (tenant && tenant.status !== "ACTIVE") {
      res.status(403).json({
        error: "تم إيقاف وصول مكتبك مؤقتاً.",
      });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role as "SYSTEM_MANAGER" | "TECHNICIAN", tenantId: user.tenantId });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId, createdAt: user.createdAt },
      token,
      theme: {
        primaryColor: tenant?.primaryColor ?? null,
        secondaryColor: tenant?.secondaryColor ?? null,
      },
      branding: {
        name: tenant?.name ?? "مكتب محاماة",
        logoUrl: tenant?.logoUrl ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.auth!.userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    // Update lastSeenAt as a presence/heartbeat signal.
    // This runs fire-and-forget so it never delays the response.
    db.update(usersTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(usersTable.id, req.auth!.userId))
      .catch((err) => logger.warn({ err }, "Failed to update lastSeenAt"));

    const [tenant] = await db
      .select({
        name: tenantsTable.name,
        logoUrl: tenantsTable.logoUrl,
        primaryColor: tenantsTable.primaryColor,
        secondaryColor: tenantsTable.secondaryColor,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, user.tenantId))
      .limit(1);
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId, createdAt: user.createdAt },
      theme: {
        primaryColor: tenant?.primaryColor ?? null,
        secondaryColor: tenant?.secondaryColor ?? null,
      },
      branding: {
        name: tenant?.name ?? "مكتب محاماة",
        logoUrl: tenant?.logoUrl ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "getMe error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", requireAuth, (_req: Request, res: Response) => {
  res.json({ success: true });
});

export default router;
