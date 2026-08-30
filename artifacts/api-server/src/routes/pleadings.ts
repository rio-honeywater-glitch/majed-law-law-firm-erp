import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { pleadingsTable, activityLogTable, casesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

function serializePleading(p: typeof pleadingsTable.$inferSelect, user?: { name: string | null; email: string; role: string } | null) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    addedByName: user ? (user.name ?? user.email) : null,
    addedByRole: user ? user.role : null,
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { caseId } = req.query as { caseId?: string };
    const rows = await db
      .select({
        pleading: pleadingsTable,
        addedByName: usersTable.name,
        addedByEmail: usersTable.email,
        addedByRole: usersTable.role,
      })
      .from(pleadingsTable)
      .leftJoin(usersTable, eq(pleadingsTable.addedById, usersTable.id))
      .where(
        scoped(req, pleadingsTable.tenantId,
          caseId ? eq(pleadingsTable.caseId, parseInt(caseId, 10)) : undefined
        )
      );

    res.json(rows.map(r => serializePleading(r.pleading, r.addedByName !== undefined ? {
      name: r.addedByName, email: r.addedByEmail ?? "", role: r.addedByRole ?? "",
    } : null)));
  } catch (err) {
    logger.error({ err }, "list pleadings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { caseId, type, content, status, managerNotes } = req.body as {
      caseId: number; type?: string; content?: string; status?: string; managerNotes?: string;
    };
    const tenantId = tenantStamp(req);
    const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable)
      .where(scoped(req, casesTable.tenantId, eq(casesTable.id, caseId))).limit(1);
    if (!caseRow) { res.status(400).json({ error: "Case not found" }); return; }

    const addedById = req.auth!.userId;

    const [pleading] = await db.insert(pleadingsTable).values({
      tenantId, caseId, type, content,
      status: (status as any) ?? "DRAFT",
      managerNotes,
      addedById,
    }).returning();

    await db.insert(activityLogTable).values({
      tenantId,
      type: "PLEADING_CREATED",
      description: `تم إنشاء مذكرة جديدة${type ? `: ${type}` : ""}`,
      entityId: pleading.id,
      entityType: "pleading",
    });

    // Fetch user info for response
    const [userRow] = await db.select({ name: usersTable.name, email: usersTable.email, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, addedById)).limit(1);

    res.status(201).json(serializePleading(pleading, userRow ?? null));
  } catch (err) {
    logger.error({ err }, "create pleading error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const [row] = await db
      .select({
        pleading: pleadingsTable,
        addedByName: usersTable.name,
        addedByEmail: usersTable.email,
        addedByRole: usersTable.role,
      })
      .from(pleadingsTable)
      .leftJoin(usersTable, eq(pleadingsTable.addedById, usersTable.id))
      .where(scoped(req, pleadingsTable.tenantId, eq(pleadingsTable.id, id)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Pleading not found" }); return; }
    res.json(serializePleading(row.pleading, row.addedByName !== undefined ? {
      name: row.addedByName, email: row.addedByEmail ?? "", role: row.addedByRole ?? "",
    } : null));
  } catch (err) {
    logger.error({ err }, "get pleading error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const { type, content, status, managerNotes } = req.body as {
      type?: string; content?: string; status?: string; managerNotes?: string;
    };
    const [updated] = await db.update(pleadingsTable).set({
      ...(type !== undefined && { type }),
      ...(content !== undefined && { content }),
      ...(status && { status: status as any }),
      ...(managerNotes !== undefined && { managerNotes }),
    }).where(scoped(req, pleadingsTable.tenantId, eq(pleadingsTable.id, id))).returning();
    if (!updated) { res.status(404).json({ error: "Pleading not found" }); return; }

    const [row] = await db
      .select({
        pleading: pleadingsTable,
        addedByName: usersTable.name,
        addedByEmail: usersTable.email,
        addedByRole: usersTable.role,
      })
      .from(pleadingsTable)
      .leftJoin(usersTable, eq(pleadingsTable.addedById, usersTable.id))
      .where(scoped(req, pleadingsTable.tenantId, eq(pleadingsTable.id, id)))
      .limit(1);

    res.json(serializePleading(row!.pleading, row!.addedByName !== undefined ? {
      name: row!.addedByName, email: row!.addedByEmail ?? "", role: row!.addedByRole ?? "",
    } : null));
  } catch (err) {
    logger.error({ err }, "update pleading error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    await db.delete(pleadingsTable).where(scoped(req, pleadingsTable.tenantId, eq(pleadingsTable.id, id)));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "delete pleading error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
