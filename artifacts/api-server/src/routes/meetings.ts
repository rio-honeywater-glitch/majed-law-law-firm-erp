import { Router, type IRouter, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  meetingsTable,
  meetingParticipantsTable,
  meetingAgendaItemsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or, asc, desc, gte, lt, aliasedTable } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import { sendPushToUsers } from "../lib/push";

const router: IRouter = Router();
router.use(requireAuth);

// ─── helpers ──────────────────────────────────────────────────────────────────

function serializeMeeting(row: typeof meetingsTable.$inferSelect) {
  return {
    ...row,
    scheduledAt: row.scheduledAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Check if the requesting user is the meeting creator or a system manager */
function canManageMeeting(req: Request, meeting: typeof meetingsTable.$inferSelect) {
  return (
    req.auth!.role === "SYSTEM_MANAGER" ||
    req.auth!.userId === meeting.createdById
  );
}

/** Check if the requesting user is a participant of the meeting */
async function getParticipant(meetingId: number, userId: number) {
  const [p] = await db
    .select()
    .from(meetingParticipantsTable)
    .where(
      and(
        eq(meetingParticipantsTable.meetingId, meetingId),
        eq(meetingParticipantsTable.userId, userId),
      ),
    )
    .limit(1);
  return p ?? null;
}

async function sendMeetingNotification(
  tenantId: number,
  userIds: number[],
  message: string,
  meetingId: number,
) {
  if (!userIds.length) return;
  await db.insert(notificationsTable).values(
    userIds.map((uid) => ({
      tenantId,
      type: "GENERAL" as const,
      message,
      relatedEntityId: meetingId,
      relatedEntityType: "meeting",
      isRead: false,
      userId: uid,
    })),
  );
}

// ─── List meetings ────────────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.auth!.userId;
    const isManager = req.auth!.role === "SYSTEM_MANAGER";

    // All meetings for this tenant
    const all = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId))
      .orderBy(asc(meetingsTable.scheduledAt));

    // For non-managers: filter to meetings the user is participant in or created
    let meetings = all;
    if (!isManager) {
      const myParticipations = await db
        .select({ meetingId: meetingParticipantsTable.meetingId })
        .from(meetingParticipantsTable)
        .where(eq(meetingParticipantsTable.userId, userId));

      const myMeetingIds = new Set([
        ...myParticipations.map((p) => p.meetingId),
      ]);

      meetings = all.filter(
        (m) => m.createdById === userId || myMeetingIds.has(m.id),
      );
    }

    // Enrich with participant counts + creator name
    const creatorAlias = aliasedTable(usersTable, "creator");

    const enriched = await Promise.all(
      meetings.map(async (m) => {
        const [creator] = await db
          .select({ name: creatorAlias.name, email: creatorAlias.email })
          .from(creatorAlias)
          .where(eq(creatorAlias.id, m.createdById))
          .limit(1);

        const participants = await db
          .select()
          .from(meetingParticipantsTable)
          .where(eq(meetingParticipantsTable.meetingId, m.id));

        const myParticipant = participants.find((p) => p.userId === userId);

        return {
          ...serializeMeeting(m),
          creatorName: creator?.name ?? creator?.email ?? null,
          participantCount: participants.length,
          myRsvp: myParticipant?.rsvpStatus ?? null,
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "list meetings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Create meeting ───────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      meetingLink,
      scheduledAt,
      reminderMinutes,
      participantIds = [],
      agendaItems = [],
    } = req.body as {
      title: string;
      description?: string;
      meetingLink?: string;
      scheduledAt: string;
      reminderMinutes?: number;
      participantIds?: number[];
      agendaItems?: { title: string; description?: string }[];
    };

    if (!title?.trim()) {
      res.status(400).json({ error: "عنوان الاجتماع مطلوب" });
      return;
    }
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
      res.status(400).json({ error: "موعد الاجتماع غير صحيح" });
      return;
    }

    const tenantId = tenantStamp(req);
    const userId = req.auth!.userId;

    const [meeting] = await db
      .insert(meetingsTable)
      .values({
        tenantId,
        title: title.trim(),
        description: description ?? null,
        meetingLink: meetingLink ?? null,
        scheduledAt: new Date(scheduledAt),
        reminderMinutes: reminderMinutes ?? 15,
        createdById: userId,
        updatedAt: new Date(),
      })
      .returning();

    // Ensure creator is always a participant
    const allParticipantIds = Array.from(
      new Set([userId, ...participantIds.filter((id) => typeof id === "number")]),
    );

    // Validate all participant IDs belong to this tenant
    const validUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(scoped(req, usersTable.tenantId));
    const validIds = new Set(validUsers.map((u) => u.id));

    const safeParticipantIds = allParticipantIds.filter((id) => validIds.has(id));

    if (safeParticipantIds.length > 0) {
      await db.insert(meetingParticipantsTable).values(
        safeParticipantIds.map((uid) => ({
          meetingId: meeting.id,
          userId: uid,
          rsvpStatus: "PENDING" as const,
          reminderSent: false,
          canEditAllAgenda: false,
        })),
      );
    }

    // Insert agenda items
    if (agendaItems.length > 0) {
      await db.insert(meetingAgendaItemsTable).values(
        agendaItems.map((item, idx) => ({
          meetingId: meeting.id,
          createdById: userId,
          title: item.title.trim(),
          description: item.description ?? null,
          recommendations: null,
          isDone: false,
          orderIndex: idx,
          updatedAt: new Date(),
        })),
      );
    }

    // Notify other participants (not the creator)
    const othersToNotify = safeParticipantIds.filter((id) => id !== userId);
    if (othersToNotify.length > 0) {
      const scheduledDate = new Date(scheduledAt).toLocaleDateString("ar-SA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const inviteMsg = `تمت دعوتك لاجتماع: "${meeting.title}" بتاريخ ${scheduledDate}`;
      await db.insert(notificationsTable).values(
        othersToNotify.map((uid) => ({
          tenantId,
          userId: uid,
          type: "GENERAL" as const,
          message: inviteMsg,
          relatedEntityId: meeting.id,
          relatedEntityType: "meeting",
          isRead: false,
        })),
      );
      sendPushToUsers(tenantId, othersToNotify, { title: "دعوة اجتماع", body: inviteMsg, url: "/meetings" }).catch(() => {});
    }

    res.status(201).json(serializeMeeting(meeting));
  } catch (err) {
    logger.error({ err }, "create meeting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Get meeting detail ───────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const userId = req.auth!.userId;
    const isManager = req.auth!.role === "SYSTEM_MANAGER";

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }

    // Access check for non-managers
    if (!isManager) {
      const participant = await getParticipant(id, userId);
      if (!participant && meeting.createdById !== userId) {
        res.status(403).json({ error: "غير مصرح لك بعرض هذا الاجتماع" });
        return;
      }
    }

    // Participants with user info
    const participants = await db
      .select({
        participant: meetingParticipantsTable,
        userName: usersTable.name,
        userEmail: usersTable.email,
        userRole: usersTable.role,
      })
      .from(meetingParticipantsTable)
      .leftJoin(usersTable, eq(meetingParticipantsTable.userId, usersTable.id))
      .where(eq(meetingParticipantsTable.meetingId, id));

    // Agenda items with creator info
    const creatorAlias = aliasedTable(usersTable, "agenda_creator");
    const agendaItems = await db
      .select({
        item: meetingAgendaItemsTable,
        creatorName: creatorAlias.name,
        creatorEmail: creatorAlias.email,
      })
      .from(meetingAgendaItemsTable)
      .leftJoin(
        creatorAlias,
        eq(meetingAgendaItemsTable.createdById, creatorAlias.id),
      )
      .where(eq(meetingAgendaItemsTable.meetingId, id))
      .orderBy(asc(meetingAgendaItemsTable.isDone), asc(meetingAgendaItemsTable.orderIndex), asc(meetingAgendaItemsTable.createdAt));

    // Creator name
    const [creator] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, meeting.createdById))
      .limit(1);

    res.json({
      ...serializeMeeting(meeting),
      creatorName: creator?.name ?? creator?.email ?? null,
      participants: participants.map((p) => ({
        ...p.participant,
        addedAt: p.participant.addedAt.toISOString(),
        userName: p.userName ?? p.userEmail ?? null,
        userEmail: p.userEmail,
        userRole: p.userRole,
      })),
      agendaItems: agendaItems.map((a) => ({
        ...a.item,
        createdAt: a.item.createdAt.toISOString(),
        updatedAt: a.item.updatedAt.toISOString(),
        creatorName: a.creatorName ?? a.creatorEmail ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "get meeting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Update meeting ───────────────────────────────────────────────────────────

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }
    if (!canManageMeeting(req, meeting)) {
      res.status(403).json({ error: "غير مصرح لك بتعديل هذا الاجتماع" });
      return;
    }

    const { title, description, meetingLink, scheduledAt, reminderMinutes } =
      req.body as {
        title?: string;
        description?: string | null;
        meetingLink?: string | null;
        scheduledAt?: string;
        reminderMinutes?: number;
      };

    if (scheduledAt !== undefined && Number.isNaN(Date.parse(scheduledAt))) {
      res.status(400).json({ error: "موعد الاجتماع غير صحيح" });
      return;
    }

    const updateData: Partial<typeof meetingsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description;
    if (meetingLink !== undefined) updateData.meetingLink = meetingLink;
    if (reminderMinutes !== undefined) updateData.reminderMinutes = reminderMinutes;

    // If schedule changed, reset all reminder-sent flags so reminders resend
    if (scheduledAt !== undefined) {
      updateData.scheduledAt = new Date(scheduledAt);
      await db
        .update(meetingParticipantsTable)
        .set({ reminderSent: false })
        .where(eq(meetingParticipantsTable.meetingId, id));
    }

    const [updated] = await db
      .update(meetingsTable)
      .set(updateData)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .returning();

    res.json(serializeMeeting(updated));
  } catch (err) {
    logger.error({ err }, "update meeting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Delete meeting ───────────────────────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }
    if (!canManageMeeting(req, meeting)) {
      res.status(403).json({ error: "غير مصرح لك بحذف هذا الاجتماع" });
      return;
    }

    await db
      .delete(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete meeting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Participants: add ────────────────────────────────────────────────────────

router.post("/:id/participants", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }
    if (!canManageMeeting(req, meeting)) {
      res.status(403).json({ error: "غير مصرح لك بإدارة المشاركين" });
      return;
    }

    const { userIds } = req.body as { userIds: number[] };
    if (!Array.isArray(userIds) || !userIds.length) {
      res.status(400).json({ error: "قائمة المشاركين مطلوبة" });
      return;
    }

    const tenantId = tenantStamp(req);

    // Validate users belong to this tenant
    const validUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(scoped(req, usersTable.tenantId));
    const validIds = new Set(validUsers.map((u) => u.id));

    // Get existing participants to avoid duplicates
    const existing = await db
      .select({ userId: meetingParticipantsTable.userId })
      .from(meetingParticipantsTable)
      .where(eq(meetingParticipantsTable.meetingId, id));
    const existingIds = new Set(existing.map((p) => p.userId));

    const toAdd = userIds.filter(
      (uid) => validIds.has(uid) && !existingIds.has(uid),
    );

    if (toAdd.length > 0) {
      await db.insert(meetingParticipantsTable).values(
        toAdd.map((uid) => ({
          meetingId: id,
          userId: uid,
          rsvpStatus: "PENDING" as const,
          reminderSent: false,
          canEditAllAgenda: false,
        })),
      );

      // Notify newly added participants
      const scheduledDate = meeting.scheduledAt.toLocaleDateString("ar-SA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const addMsg = `تمت دعوتك لاجتماع: "${meeting.title}" بتاريخ ${scheduledDate}`;
      await db.insert(notificationsTable).values(
        toAdd.map((uid) => ({
          tenantId,
          userId: uid,
          type: "GENERAL" as const,
          message: addMsg,
          relatedEntityId: id,
          relatedEntityType: "meeting",
          isRead: false,
        })),
      );
      sendPushToUsers(tenantId, toAdd, { title: "دعوة اجتماع", body: addMsg, url: "/meetings" }).catch(() => {});
    }

    const participants = await db
      .select({
        participant: meetingParticipantsTable,
        userName: usersTable.name,
        userEmail: usersTable.email,
        userRole: usersTable.role,
      })
      .from(meetingParticipantsTable)
      .leftJoin(usersTable, eq(meetingParticipantsTable.userId, usersTable.id))
      .where(eq(meetingParticipantsTable.meetingId, id));

    res.json(
      participants.map((p) => ({
        ...p.participant,
        addedAt: p.participant.addedAt.toISOString(),
        userName: p.userName ?? p.userEmail ?? null,
        userEmail: p.userEmail,
        userRole: p.userRole,
      })),
    );
  } catch (err) {
    logger.error({ err }, "add participants error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Participants: remove ─────────────────────────────────────────────────────

router.delete("/:id/participants/:userId", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const targetUserId = parseInt(req.params["userId"] as string, 10);

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }
    if (!canManageMeeting(req, meeting)) {
      res.status(403).json({ error: "غير مصرح لك بإدارة المشاركين" });
      return;
    }

    await db
      .delete(meetingParticipantsTable)
      .where(
        and(
          eq(meetingParticipantsTable.meetingId, id),
          eq(meetingParticipantsTable.userId, targetUserId),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "remove participant error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── RSVP ────────────────────────────────────────────────────────────────────

router.patch("/:id/rsvp", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const userId = req.auth!.userId;

    const { status } = req.body as {
      status: "ATTENDING" | "DECLINED" | "UNCERTAIN";
    };

    if (!["ATTENDING", "DECLINED", "UNCERTAIN"].includes(status)) {
      res.status(400).json({ error: "حالة RSVP غير صحيحة" });
      return;
    }

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }

    const participant = await getParticipant(id, userId);
    if (!participant) {
      res.status(403).json({ error: "أنت لست مشاركاً في هذا الاجتماع" });
      return;
    }

    const [updated] = await db
      .update(meetingParticipantsTable)
      .set({ rsvpStatus: status })
      .where(
        and(
          eq(meetingParticipantsTable.meetingId, id),
          eq(meetingParticipantsTable.userId, userId),
        ),
      )
      .returning();

    res.json({ ...updated, addedAt: updated.addedAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "rsvp error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Toggle agenda edit permission ───────────────────────────────────────────

router.patch("/:id/participants/:userId/permission", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const targetUserId = parseInt(req.params["userId"] as string, 10);

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }
    if (!canManageMeeting(req, meeting)) {
      res.status(403).json({ error: "غير مصرح لك بمنح الصلاحيات" });
      return;
    }

    const { canEditAllAgenda } = req.body as { canEditAllAgenda: boolean };

    const [updated] = await db
      .update(meetingParticipantsTable)
      .set({ canEditAllAgenda })
      .where(
        and(
          eq(meetingParticipantsTable.meetingId, id),
          eq(meetingParticipantsTable.userId, targetUserId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "المشارك غير موجود" });
      return;
    }

    res.json({ ...updated, addedAt: updated.addedAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "toggle permission error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Agenda: add item ─────────────────────────────────────────────────────────

router.post("/:id/agenda", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const userId = req.auth!.userId;
    const isManager = req.auth!.role === "SYSTEM_MANAGER";

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, id)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }

    // Must be a participant or manager
    if (!isManager && meeting.createdById !== userId) {
      const participant = await getParticipant(id, userId);
      if (!participant) {
        res.status(403).json({ error: "غير مصرح لك بإضافة محاور" });
        return;
      }
    }

    const { title, description } = req.body as {
      title: string;
      description?: string;
    };

    if (!title?.trim()) {
      res.status(400).json({ error: "عنوان المحور مطلوب" });
      return;
    }

    // Get max order
    const existingItems = await db
      .select({ orderIndex: meetingAgendaItemsTable.orderIndex })
      .from(meetingAgendaItemsTable)
      .where(eq(meetingAgendaItemsTable.meetingId, id))
      .orderBy(desc(meetingAgendaItemsTable.orderIndex))
      .limit(1);

    const nextOrder = (existingItems[0]?.orderIndex ?? -1) + 1;

    const [item] = await db
      .insert(meetingAgendaItemsTable)
      .values({
        meetingId: id,
        createdById: userId,
        title: title.trim(),
        description: description ?? null,
        recommendations: null,
        isDone: false,
        orderIndex: nextOrder,
        updatedAt: new Date(),
      })
      .returning();

    const [creator] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    res.status(201).json({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      creatorName: creator?.name ?? creator?.email ?? null,
    });
  } catch (err) {
    logger.error({ err }, "add agenda item error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Agenda: update item ──────────────────────────────────────────────────────

router.patch("/:id/agenda/:itemId", async (req: Request, res: Response) => {
  try {
    const meetingId = parseInt(req.params["id"] as string, 10);
    const itemId = parseInt(req.params["itemId"] as string, 10);
    const userId = req.auth!.userId;
    const isManager = req.auth!.role === "SYSTEM_MANAGER";

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, meetingId)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }

    const [item] = await db
      .select()
      .from(meetingAgendaItemsTable)
      .where(
        and(
          eq(meetingAgendaItemsTable.id, itemId),
          eq(meetingAgendaItemsTable.meetingId, meetingId),
        ),
      )
      .limit(1);

    if (!item) {
      res.status(404).json({ error: "المحور غير موجود" });
      return;
    }

    const isCreator = meeting.createdById === userId;
    const isItemOwner = item.createdById === userId;

    // Check participant for canEditAllAgenda
    const participant = await getParticipant(meetingId, userId);
    const hasEditAllPerm = participant?.canEditAllAgenda ?? false;

    const { title, description, recommendations, isDone } = req.body as {
      title?: string;
      description?: string | null;
      recommendations?: string | null;
      isDone?: boolean;
    };

    // isDone toggle: only manager, meeting creator, or item owner
    if (isDone !== undefined && !isManager && !isCreator && !isItemOwner) {
      res.status(403).json({ error: "غير مصرح لك بتعليم المحور كمنجز" });
      return;
    }

    // Full edit: manager, meeting creator, item owner, or granted canEditAllAgenda (but NOT isDone)
    const wantsFullEdit = title !== undefined || description !== undefined || recommendations !== undefined;
    if (wantsFullEdit && !isManager && !isCreator && !isItemOwner && !hasEditAllPerm) {
      res.status(403).json({ error: "غير مصرح لك بتعديل هذا المحور" });
      return;
    }

    const updateData: Partial<typeof meetingAgendaItemsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description;
    if (recommendations !== undefined) updateData.recommendations = recommendations;
    if (isDone !== undefined) updateData.isDone = isDone;

    const [updated] = await db
      .update(meetingAgendaItemsTable)
      .set(updateData)
      .where(eq(meetingAgendaItemsTable.id, itemId))
      .returning();

    const [creator] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, updated.createdById))
      .limit(1);

    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      creatorName: creator?.name ?? creator?.email ?? null,
    });
  } catch (err) {
    logger.error({ err }, "update agenda item error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Agenda: delete item ──────────────────────────────────────────────────────

router.delete("/:id/agenda/:itemId", async (req: Request, res: Response) => {
  try {
    const meetingId = parseInt(req.params["id"] as string, 10);
    const itemId = parseInt(req.params["itemId"] as string, 10);
    const userId = req.auth!.userId;
    const isManager = req.auth!.role === "SYSTEM_MANAGER";

    const [meeting] = await db
      .select()
      .from(meetingsTable)
      .where(scoped(req, meetingsTable.tenantId, eq(meetingsTable.id, meetingId)))
      .limit(1);

    if (!meeting) {
      res.status(404).json({ error: "الاجتماع غير موجود" });
      return;
    }

    const [item] = await db
      .select()
      .from(meetingAgendaItemsTable)
      .where(
        and(
          eq(meetingAgendaItemsTable.id, itemId),
          eq(meetingAgendaItemsTable.meetingId, meetingId),
        ),
      )
      .limit(1);

    if (!item) {
      res.status(404).json({ error: "المحور غير موجود" });
      return;
    }

    const isCreator = meeting.createdById === userId;
    const isItemOwner = item.createdById === userId;

    if (!isManager && !isCreator && !isItemOwner) {
      res.status(403).json({ error: "غير مصرح لك بحذف هذا المحور" });
      return;
    }

    await db
      .delete(meetingAgendaItemsTable)
      .where(eq(meetingAgendaItemsTable.id, itemId));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete agenda item error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
