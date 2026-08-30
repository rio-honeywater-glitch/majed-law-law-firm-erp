import { Router, type IRouter, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, activityLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSystemManager } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth);

function toUserSummary(u: { id: number; email: string; name: string | null; role: string; tenantId: number; avatarBase64?: string | null; phone?: string | null }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, tenantId: u.tenantId, avatarBase64: u.avatarBase64 ?? null, phone: u.phone ?? null };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role, tenantId: usersTable.tenantId, avatarBase64: usersTable.avatarBase64, phone: usersTable.phone })
      .from(usersTable)
      .where(scoped(req, usersTable.tenantId))
      .orderBy(usersTable.name);
    // Non-managers only need names for task assignment — redact emails.
    const isManager = req.auth!.role === "SYSTEM_MANAGER";
    res.json(isManager ? rows : rows.map((r) => ({ ...r, email: "" })));
  } catch (err) {
    logger.error({ err }, "list users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "بيانات غير صالحة. تأكد من الاسم والبريد الإلكتروني وكلمة المرور (6 أحرف على الأقل) والدور." });
      return;
    }
    const { name, email, password, role, phone } = parsed.data;
    // Role is restricted to SYSTEM_MANAGER | TECHNICIAN by the request schema.
    const tenantId = tenantStamp(req);
    const normalizedEmail = email.trim().toLowerCase();

    // Email is globally unique across all firms.
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
    if (existing) {
      res.status(409).json({ error: "البريد الإلكتروني مستخدم مسبقاً." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [created] = await db.insert(usersTable).values({
      tenantId,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role,
      ...(phone ? { phone: phone.trim() } : {}),
    }).returning();

    await db.insert(activityLogTable).values({
      tenantId,
      type: "USER_CREATED",
      description: `تم إنشاء مستخدم جديد: ${created.name || created.email}`,
      entityId: created.id,
      entityType: "user",
    });

    req.log.info({ userId: created.id }, "user created");
    res.status(201).json(toUserSummary(created));
  } catch (err) {
    logger.error({ err }, "create user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (Number.isNaN(id)) { res.status(404).json({ error: "المستخدم غير موجود." }); return; }

    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "بيانات غير صالحة." });
      return;
    }
    const { name, email, password, role, phone } = parsed.data;
    // The request schema restricts role to firm-level roles, so SUPER_ADMIN
    // can never be assigned through this endpoint.

    const [target] = await db.select().from(usersTable)
      .where(scoped(req, usersTable.tenantId, eq(usersTable.id, id))).limit(1);
    if (!target) { res.status(404).json({ error: "المستخدم غير موجود." }); return; }

    const currentUserId = req.auth!.userId;
    if (id === currentUserId && role && role !== "SYSTEM_MANAGER") {
      res.status(400).json({ error: "لا يمكنك تغيير دورك الخاص من مدير النظام." });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail !== target.email) {
        const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
        if (existing) {
          res.status(409).json({ error: "البريد الإلكتروني مستخدم مسبقاً." });
          return;
        }
      }
      updateData.email = normalizedEmail;
    }
    if (password !== undefined && password.length > 0) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }
    if (role !== undefined) updateData.role = role;
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : null;

    if (Object.keys(updateData).length === 0) {
      res.json(toUserSummary(target));
      return;
    }

    const [updated] = await db.update(usersTable).set(updateData)
      .where(scoped(req, usersTable.tenantId, eq(usersTable.id, id))).returning();

    await db.insert(activityLogTable).values({
      tenantId: updated.tenantId,
      type: "USER_UPDATED",
      description: `تم تحديث بيانات المستخدم: ${updated.name || updated.email}`,
      entityId: updated.id,
      entityType: "user",
    });

    req.log.info({ userId: updated.id }, "user updated");
    res.json(toUserSummary(updated));
  } catch (err) {
    logger.error({ err }, "update user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (Number.isNaN(id)) { res.status(404).json({ error: "المستخدم غير موجود." }); return; }

    const currentUserId = req.auth!.userId;
    if (id === currentUserId) {
      res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص." });
      return;
    }

    const [target] = await db.select().from(usersTable)
      .where(scoped(req, usersTable.tenantId, eq(usersTable.id, id))).limit(1);
    if (!target) { res.status(404).json({ error: "المستخدم غير موجود." }); return; }

    await db.delete(usersTable).where(scoped(req, usersTable.tenantId, eq(usersTable.id, id)));

    await db.insert(activityLogTable).values({
      tenantId: target.tenantId,
      type: "USER_DELETED",
      description: `تم حذف المستخدم: ${target.name || target.email}`,
      entityId: id,
      entityType: "user",
    });

    req.log.info({ userId: id }, "user deleted");
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "delete user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
