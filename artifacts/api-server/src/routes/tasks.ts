import { Router, type IRouter, Request, Response } from "express";
import { db } from "@workspace/db";
import { tasksTable, usersTable, activityLogTable, systemSettingsTable, casesTable } from "@workspace/db";
import { eq, and, or, lte, isNull, asc, aliasedTable, sql } from "drizzle-orm";
import type { NextFunction } from "express";
import { requireAuth } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

// Block the whole module when the manager has hidden it (default: visible)
router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, "TASKS_MODULE_VISIBLE")))
      .limit(1);
    if (row && !row.value) {
      res.status(403).json({ error: "Tasks module is disabled" });
      return;
    }
    next();
  } catch (err) {
    logger.error({ err }, "tasks module visibility check error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const assigneeUsers = aliasedTable(usersTable, "assignee_users");

function buildCaseName(caseNumber: string | null, subject: string | null, caseId: number | null): string | null {
  if (!caseId) return null;
  if (caseNumber && subject) return `${caseNumber} – ${subject}`;
  if (caseNumber) return caseNumber;
  if (subject) return subject;
  return `قضية #${caseId}`;
}

function timeframeUpperBound(timeframe?: string): Date | null {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  switch (timeframe) {
    case "today":
      return end;
    case "week":
      end.setDate(end.getDate() + 6);
      return end;
    case "month":
      end.setDate(end.getDate() + 29);
      return end;
    default:
      return null;
  }
}

function serializeTask(row: {
  task: typeof tasksTable.$inferSelect;
  assignedByName: string | null;
  assignedByEmail: string | null;
  assignedToName: string | null;
  assignedToEmail: string | null;
  caseCaseNumber: string | null;
  caseSubject: string | null;
}) {
  const { task } = row;
  return {
    ...task,
    dueDate: task.dueDate.toISOString(),
    createdAt: task.createdAt.toISOString(),
    deletedAt: task.deletedAt?.toISOString() ?? null,
    assignedByName: row.assignedByName ?? row.assignedByEmail,
    assignedToName: task.assignedToId ? (row.assignedToName ?? row.assignedToEmail) : null,
    caseName: buildCaseName(row.caseCaseNumber, row.caseSubject, task.caseId ?? null),
  };
}

const taskSelection = {
  task: tasksTable,
  assignedByName: usersTable.name,
  assignedByEmail: usersTable.email,
  assignedToName: assigneeUsers.name,
  assignedToEmail: assigneeUsers.email,
  caseCaseNumber: casesTable.caseNumber,
  caseSubject: casesTable.subject,
};

router.get("/", async (req: Request, res: Response) => {
  try {
    const { timeframe, show_all, show_deleted } = req.query as {
      timeframe?: string; show_all?: string; show_deleted?: string;
    };
    const userId = req.auth!.userId;
    const showAll = show_all === "true";
    const showDeleted = show_deleted === "true";

    const conditions = [];
    const upper = timeframeUpperBound(timeframe);
    if (upper) conditions.push(lte(tasksTable.dueDate, upper));
    if (!showAll) {
      conditions.push(or(eq(tasksTable.assignedToId, userId), isNull(tasksTable.assignedToId)));
    }
    // By default hide soft-deleted tasks; include them when show_deleted=true
    if (!showDeleted) {
      conditions.push(isNull(tasksTable.deletedAt));
    }

    const rows = await db
      .select(taskSelection)
      .from(tasksTable)
      .leftJoin(usersTable, eq(tasksTable.assignedById, usersTable.id))
      .leftJoin(assigneeUsers, eq(tasksTable.assignedToId, assigneeUsers.id))
      .leftJoin(casesTable, eq(tasksTable.caseId, casesTable.id))
      .where(scoped(req, tasksTable.tenantId, ...conditions))
      .orderBy(asc(tasksTable.dueDate));

    res.json(rows.map(serializeTask));
  } catch (err) {
    logger.error({ err }, "list tasks error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { title, description, dueDate, assignedToId, caseId, linkUrl } = req.body as {
      title: string; description?: string | null; dueDate: string; assignedToId?: number | null; caseId?: number | null; linkUrl?: string | null;
    };
    if (!title?.trim() || !dueDate || Number.isNaN(Date.parse(dueDate))) {
      res.status(400).json({ error: "title and a valid dueDate are required" });
      return;
    }
    const tenantId = tenantStamp(req);

    // If an assignee is specified, it must be a user of the same firm.
    if (assignedToId != null) {
      const [assignee] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(scoped(req, usersTable.tenantId, eq(usersTable.id, assignedToId))).limit(1);
      if (!assignee) { res.status(400).json({ error: "Assignee not found" }); return; }
    }

    // If a case is specified, it must belong to the same firm (tenant isolation).
    if (caseId != null) {
      const [caseRow] = await db.select({ id: casesTable.id }).from(casesTable)
        .where(scoped(req, casesTable.tenantId, eq(casesTable.id, caseId))).limit(1);
      if (!caseRow) { res.status(400).json({ error: "Case not found" }); return; }
    }

    const [task] = await db.insert(tasksTable).values({
      tenantId,
      title: title.trim(),
      description: description ?? null,
      taskType: "MANUAL",
      dueDate: new Date(dueDate),
      assignedById: req.auth!.userId,
      assignedToId: assignedToId ?? null,
      caseId: caseId ?? null,
      linkUrl: linkUrl ?? null,
    }).returning();

    await db.insert(activityLogTable).values({
      tenantId,
      type: "TASK_CREATED",
      description: `تم إنشاء مهمة جديدة: ${task.title}`,
      entityId: task.id,
      entityType: "task",
    });

    const [row] = await db
      .select(taskSelection)
      .from(tasksTable)
      .leftJoin(usersTable, eq(tasksTable.assignedById, usersTable.id))
      .leftJoin(assigneeUsers, eq(tasksTable.assignedToId, assigneeUsers.id))
      .leftJoin(casesTable, eq(tasksTable.caseId, casesTable.id))
      .where(scoped(req, tasksTable.tenantId, eq(tasksTable.id, task.id)))
      .limit(1);

    res.status(201).json(serializeTask(row));
  } catch (err) {
    logger.error({ err }, "create task error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const { title, description, dueDate, assignedToId, status, linkUrl } = req.body as {
      title?: string; description?: string | null; dueDate?: string;
      assignedToId?: number | null; status?: "PENDING" | "COMPLETED"; linkUrl?: string | null;
    };

    const [existing] = await db.select().from(tasksTable)
      .where(scoped(req, tasksTable.tenantId, eq(tasksTable.id, id))).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const userId = req.auth!.userId;
    const isManager = req.auth!.role === "SYSTEM_MANAGER";
    const isCreator = existing.assignedById === userId;
    const isAssignee = existing.assignedToId === userId || existing.assignedToId === null;
    const statusOnly =
      status !== undefined &&
      title === undefined && description === undefined &&
      dueDate === undefined && assignedToId === undefined;

    // Full edits: creator or manager. Status-only toggle: also allowed for the assignee (or anyone on team-wide tasks).
    if (!isManager && !isCreator && !(statusOnly && isAssignee)) {
      res.status(403).json({ error: "You are not allowed to modify this task" });
      return;
    }

    if (dueDate !== undefined && Number.isNaN(Date.parse(dueDate))) {
      res.status(400).json({ error: "invalid dueDate" });
      return;
    }
    if (status !== undefined && status !== "PENDING" && status !== "COMPLETED") {
      res.status(400).json({ error: "invalid status" });
      return;
    }
    // Reassignment must stay within the firm — never link a task to a user from
    // another tenant.
    if (assignedToId != null) {
      const [assignee] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(scoped(req, usersTable.tenantId, eq(usersTable.id, assignedToId))).limit(1);
      if (!assignee) {
        res.status(400).json({ error: "المستخدم المحدد غير موجود." });
        return;
      }
    }

    const [updated] = await db.update(tasksTable).set({
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description }),
      ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
      ...(assignedToId !== undefined && { assignedToId }),
      ...(status !== undefined && { status }),
      ...(linkUrl !== undefined && { linkUrl }),
    }).where(scoped(req, tasksTable.tenantId, eq(tasksTable.id, id))).returning();

    if (!updated) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (status === "COMPLETED") {
      await db.insert(activityLogTable).values({
        tenantId: updated.tenantId,
        type: "TASK_COMPLETED",
        description: `تم إنجاز المهمة: ${updated.title}`,
        entityId: updated.id,
        entityType: "task",
      });
    }

    const [row] = await db
      .select(taskSelection)
      .from(tasksTable)
      .leftJoin(usersTable, eq(tasksTable.assignedById, usersTable.id))
      .leftJoin(assigneeUsers, eq(tasksTable.assignedToId, assigneeUsers.id))
      .leftJoin(casesTable, eq(tasksTable.caseId, casesTable.id))
      .where(scoped(req, tasksTable.tenantId, eq(tasksTable.id, updated.id)))
      .limit(1);

    res.json(serializeTask(row));
  } catch (err) {
    logger.error({ err }, "update task error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const [task] = await db.select().from(tasksTable)
      .where(scoped(req, tasksTable.tenantId, eq(tasksTable.id, id))).limit(1);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const isManager = req.auth!.role === "SYSTEM_MANAGER";
    if (!isManager && task.assignedById !== req.auth!.userId) {
      res.status(403).json({ error: "Only the task creator or a manager can delete this task" });
      return;
    }

    // Soft-delete: toggle — if already deleted, restore it; otherwise mark deleted
    const nowOrNull = task.deletedAt ? null : new Date();
    const [updated] = await db
      .update(tasksTable)
      .set({ deletedAt: nowOrNull })
      .where(scoped(req, tasksTable.tenantId, eq(tasksTable.id, id)))
      .returning();

    const assigneeAlias = aliasedTable(usersTable, "assignee_users2");
    const [row] = await db
      .select({
        task: tasksTable,
        assignedByName: usersTable.name,
        assignedByEmail: usersTable.email,
        assignedToName: assigneeAlias.name,
        assignedToEmail: assigneeAlias.email,
        caseCaseNumber: casesTable.caseNumber,
        caseSubject: casesTable.subject,
      })
      .from(tasksTable)
      .leftJoin(usersTable, eq(tasksTable.assignedById, usersTable.id))
      .leftJoin(assigneeAlias, eq(tasksTable.assignedToId, assigneeAlias.id))
      .leftJoin(casesTable, eq(tasksTable.caseId, casesTable.id))
      .where(scoped(req, tasksTable.tenantId, eq(tasksTable.id, updated.id)))
      .limit(1);

    res.json(serializeTask(row));
  } catch (err) {
    logger.error({ err }, "delete task error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
