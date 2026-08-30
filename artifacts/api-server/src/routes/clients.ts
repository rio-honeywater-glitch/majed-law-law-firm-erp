import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { clientsTable, casesTable, contractsTable, activityLogTable } from "@workspace/db";
import { eq, ilike, or, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

const AGENCY_SOURCES = ["خدمات الموثقين", "الخدمات الالكترونية"] as const;

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseAgencyFields(body: Record<string, unknown>, partial = false) {
  const result: {
    agencyNumber?: string | null;
    agencyEndDate?: string | null;
    agencySource?: typeof AGENCY_SOURCES[number] | null;
    error?: string;
  } = {};

  if (!partial || "agencyNumber" in body) {
    result.agencyNumber = typeof body.agencyNumber === "string" && body.agencyNumber.trim()
      ? body.agencyNumber.trim()
      : null;
  }
  if (!partial || "agencyEndDate" in body) {
    if (body.agencyEndDate == null || body.agencyEndDate === "") {
      result.agencyEndDate = null;
    } else if (
      typeof body.agencyEndDate !== "string"
      || !isValidIsoDate(body.agencyEndDate)
    ) {
      result.error = "تاريخ انتهاء الوكالة غير صالح.";
    } else {
      result.agencyEndDate = body.agencyEndDate;
    }
  }
  if (!partial || "agencySource" in body) {
    if (body.agencySource == null || body.agencySource === "") {
      result.agencySource = null;
    } else if (
      typeof body.agencySource !== "string"
      || !AGENCY_SOURCES.includes(body.agencySource as typeof AGENCY_SOURCES[number])
    ) {
      result.error = "مصدر الوكالة غير صالح.";
    } else {
      result.agencySource = body.agencySource as typeof AGENCY_SOURCES[number];
    }
  }
  return result;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { search } = req.query as { search?: string };
    const searchCond = search
      ? or(ilike(clientsTable.name, `%${search}%`), ilike(clientsTable.phone ?? clientsTable.name, `%${search}%`))
      : undefined;
    const rows = await db
      .select()
      .from(clientsTable)
      .where(scoped(req, clientsTable.tenantId, searchCond))
      .orderBy(clientsTable.createdAt);
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "list clients error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email, phone, nationalId, address, notes } = req.body as {
      name: string; email?: string; phone?: string; nationalId?: string; address?: string; notes?: string;
    };
    if (!name) { res.status(400).json({ error: "Name is required" }); return; }
    const agency = parseAgencyFields(req.body as Record<string, unknown>);
    if (agency.error) { res.status(400).json({ error: agency.error }); return; }
    const tenantId = tenantStamp(req);
    const [client] = await db.insert(clientsTable).values({
      tenantId, name, email, phone, nationalId, address, notes,
      agencyNumber: agency.agencyNumber,
      agencyEndDate: agency.agencyEndDate,
      agencySource: agency.agencySource,
    }).returning();
    await db.insert(activityLogTable).values({
      tenantId,
      type: "CLIENT_CREATED",
      description: `تم إنشاء موكل جديد: ${name}`,
      entityId: client.id,
      entityType: "client",
    });
    res.status(201).json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "create client error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const [client] = await db.select().from(clientsTable)
      .where(scoped(req, clientsTable.tenantId, eq(clientsTable.id, id))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const [cases, contracts] = await Promise.all([
      db.select().from(casesTable).where(scoped(req, casesTable.tenantId, eq(casesTable.clientId, id))),
      db.select().from(contractsTable).where(scoped(req, contractsTable.tenantId, eq(contractsTable.clientId, id))),
    ]);

    res.json({
      ...client,
      createdAt: client.createdAt.toISOString(),
      cases: cases.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
      contracts: contracts.map(c => ({ ...c, fees: c.fees ? parseFloat(c.fees) : null, createdAt: c.createdAt.toISOString() })),
    });
  } catch (err) {
    logger.error({ err }, "get client error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    const { name, email, phone, nationalId, address, notes } = req.body as {
      name?: string; email?: string; phone?: string; nationalId?: string; address?: string; notes?: string;
    };
    const agency = parseAgencyFields(req.body as Record<string, unknown>, true);
    if (agency.error) { res.status(400).json({ error: agency.error }); return; }
    const { error: _agencyError, ...agencyValues } = agency;
    const [client] = await db.update(clientsTable)
      .set({ ...(name && { name }), email, phone, nationalId, address, notes, ...agencyValues })
      .where(scoped(req, clientsTable.tenantId, eq(clientsTable.id, id))).returning();
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }
    res.json({ ...client, createdAt: client.createdAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "update client error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    await db.delete(clientsTable).where(scoped(req, clientsTable.tenantId, eq(clientsTable.id, id)));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "delete client error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
