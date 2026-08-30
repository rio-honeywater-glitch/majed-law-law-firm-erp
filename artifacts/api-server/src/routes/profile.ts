import { Router, type IRouter, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, and, not } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped } from "../lib/tenant";
import { logger } from "../lib/logger";
import { UpdateProfileBody } from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth);

function toProfileSummary(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    tenantId: u.tenantId,
    avatarBase64: u.avatarBase64 ?? null,
  };
}

// GET /api/profile — own profile
router.get("/", async (req: Request, res: Response) => {
  try {
    const [user] = await db.select().from(usersTable)
      .where(scoped(req, usersTable.tenantId, eq(usersTable.id, req.auth!.userId))).limit(1);
    if (!user) { res.status(404).json({ error: "المستخدم غير موجود." }); return; }
    res.json(toProfileSummary(user));
  } catch (err) {
    logger.error({ err }, "get profile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/profile — update own profile
router.patch("/", async (req: Request, res: Response) => {
  try {
    const parsed = UpdateProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "بيانات غير صالحة." });
      return;
    }
    const { name, email, password, avatarBase64 } = parsed.data;

    const [current] = await db.select().from(usersTable)
      .where(scoped(req, usersTable.tenantId, eq(usersTable.id, req.auth!.userId))).limit(1);
    if (!current) { res.status(404).json({ error: "المستخدم غير موجود." }); return; }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      // Always exclude the current user from the uniqueness check so sending
      // the same email never triggers a false 409.
      const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.email, normalizedEmail), not(eq(usersTable.id, req.auth!.userId)))).limit(1);
      if (existing) {
        res.status(409).json({ error: "البريد الإلكتروني مستخدم مسبقاً." });
        return;
      }
      updateData.email = normalizedEmail;
    }
    if (password !== undefined && password.length >= 6) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }
    if (avatarBase64 !== undefined) {
      updateData.avatarBase64 = avatarBase64;
    }

    if (Object.keys(updateData).length === 0) {
      res.json(toProfileSummary(current));
      return;
    }

    const [updated] = await db.update(usersTable).set(updateData)
      .where(scoped(req, usersTable.tenantId, eq(usersTable.id, req.auth!.userId))).returning();

    req.log.info({ userId: updated!.id }, "profile updated");
    res.json(toProfileSummary(updated!));
  } catch (err) {
    logger.error({ err }, "update profile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
