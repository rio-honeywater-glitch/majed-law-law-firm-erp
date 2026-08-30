import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  activityLogTable,
  casesTable,
  clientsTable,
  db,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { CreateCaseResponse } from "@workspace/api-zod";

process.env.NODE_ENV = "test";

const { default: app } = await import("../app.js");
const { signToken } = await import("../middlewares/auth.js");

interface Fixtures {
  tenantId: number;
  token: string;
}

let fx: Fixtures;

function authed() {
  return { Authorization: `Bearer ${fx.token}` };
}

before(async () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `__test_case_atomic_${suffix}__`, status: "ACTIVE" })
    .returning({ id: tenantsTable.id });
  const [user] = await db
    .insert(usersTable)
    .values({
      tenantId: tenant!.id,
      email: `case_atomic_${suffix}@example.com`,
      passwordHash: "test-hash",
      role: "TECHNICIAN",
    })
    .returning({ id: usersTable.id });

  fx = {
    tenantId: tenant!.id,
    token: signToken({
      userId: user!.id,
      email: `case_atomic_${suffix}@example.com`,
      role: "TECHNICIAN",
      tenantId: tenant!.id,
    }),
  };
});

after(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.id, fx.tenantId));
});

describe("Atomic case creation with a new client", () => {
  test("creates the client and case together on success", async () => {
    const clientName = `عميل نجاح ذري ${Date.now()}`;
    const response = await request(app)
      .post("/api/cases")
      .set(authed())
      .send({
        newClient: { name: clientName },
        subject: "قضية إنشاء ذري",
        status: "UNDER_REVIEW",
      })
      .expect(201);

    const parsed = CreateCaseResponse.safeParse(response.body);
    assert.equal(
      parsed.success,
      true,
      parsed.success ? undefined : JSON.stringify(parsed.error.issues),
    );

    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, fx.tenantId),
        eq(clientsTable.name, clientName),
      ))
      .limit(1);
    assert.ok(client);

    const [caseRow] = await db
      .select({ clientId: casesTable.clientId })
      .from(casesTable)
      .where(and(
        eq(casesTable.tenantId, fx.tenantId),
        eq(casesTable.id, response.body.id as number),
      ))
      .limit(1);
    assert.equal(caseRow?.clientId, client.id);
  });

  test("rolls back the client and its activity log when the case insert fails", async () => {
    const clientName = `عميل تراجع ذري ${Date.now()}`;
    const clientLogDescription = `تم إنشاء موكل جديد: ${clientName}`;

    await request(app)
      .post("/api/cases")
      .set(authed())
      .send({
        newClient: { name: clientName },
        subject: "قضية يجب أن تفشل",
        status: "INVALID_STATUS",
      })
      .expect(500);

    const clients = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, fx.tenantId),
        eq(clientsTable.name, clientName),
      ));
    assert.equal(clients.length, 0);

    const activityLogs = await db
      .select({ id: activityLogTable.id })
      .from(activityLogTable)
      .where(and(
        eq(activityLogTable.tenantId, fx.tenantId),
        eq(activityLogTable.description, clientLogDescription),
      ));
    assert.equal(activityLogs.length, 0);
  });
});