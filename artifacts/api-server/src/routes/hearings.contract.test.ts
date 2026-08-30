import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  casesTable,
  clientsTable,
  db,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateHearingResponse,
  GetHearingResponse,
  GetCaseResponse,
  ListHearingsResponseItem,
  UpdateHearingResponse,
} from "@workspace/api-zod";

process.env.NODE_ENV = "test";

const { default: app } = await import("../app.js");
const { signToken } = await import("../middlewares/auth.js");

interface Fixtures {
  tenantId: number;
  caseId: number;
  token: string;
}

let fx: Fixtures;

function authed() {
  return { Authorization: `Bearer ${fx.token}` };
}

function assertHearingResponse(
  schema: Pick<typeof CreateHearingResponse, "safeParse">,
  value: unknown,
) {
  const parsed = schema.safeParse(value);
  assert.equal(
    parsed.success,
    true,
    parsed.success ? undefined : JSON.stringify(parsed.error.issues),
  );
}

before(async () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `__test_hearing_contract_${suffix}__`, status: "ACTIVE" })
    .returning({ id: tenantsTable.id });
  const [user] = await db
    .insert(usersTable)
    .values({
      tenantId: tenant!.id,
      email: `hearing_contract_${suffix}@example.com`,
      passwordHash: "test-hash",
      role: "TECHNICIAN",
    })
    .returning({ id: usersTable.id });
  const [client] = await db
    .insert(clientsTable)
    .values({ tenantId: tenant!.id, name: "عميل اختبار عقد الجلسة" })
    .returning({ id: clientsTable.id });
  const [caseRow] = await db
    .insert(casesTable)
    .values({
      tenantId: tenant!.id,
      clientId: client!.id,
      subject: "قضية اختبار عقد الجلسة",
    })
    .returning({ id: casesTable.id });

  fx = {
    tenantId: tenant!.id,
    caseId: caseRow!.id,
    token: signToken({
      userId: user!.id,
      email: `hearing_contract_${suffix}@example.com`,
      role: "TECHNICIAN",
      tenantId: tenant!.id,
    }),
  };
});

after(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.id, fx.tenantId));
});

describe("Hearing API response contract", () => {
  test("list, create, get, and update responses include valid status fields", async () => {
    const createResponse = await request(app)
      .post("/api/hearings")
      .set(authed())
      .send({
        caseId: fx.caseId,
        hijriDate: "01/01/1450",
        utcDate: new Date(Date.now() + 86_400_000).toISOString(),
        requiresLawsuitEditing: false,
        requiresReplyPrep: false,
      })
      .expect(201);

    assertHearingResponse(CreateHearingResponse, createResponse.body);
    assert.equal(createResponse.body.status, null);
    assert.equal(createResponse.body.effectiveStatus, "UPCOMING");

    const hearingId = createResponse.body.id as number;

    const listResponse = await request(app)
      .get(`/api/hearings?caseId=${fx.caseId}`)
      .set(authed())
      .expect(200);
    assert.ok(Array.isArray(listResponse.body));
    assert.ok(listResponse.body.length > 0);
    listResponse.body.forEach((hearing: unknown) => {
      assertHearingResponse(ListHearingsResponseItem, hearing);
    });

    const getResponse = await request(app)
      .get(`/api/hearings/${hearingId}`)
      .set(authed())
      .expect(200);
    assertHearingResponse(GetHearingResponse, getResponse.body);

    const caseDetailResponse = await request(app)
      .get(`/api/cases/${fx.caseId}`)
      .set(authed())
      .expect(200);
    const parsedCaseDetail = GetCaseResponse.safeParse(caseDetailResponse.body);
    assert.equal(
      parsedCaseDetail.success,
      true,
      parsedCaseDetail.success
        ? undefined
        : JSON.stringify(parsedCaseDetail.error.issues),
    );
    assert.equal(caseDetailResponse.body.hearings[0].effectiveStatus, "UPCOMING");

    await request(app)
      .patch(`/api/hearings/${hearingId}`)
      .set(authed())
      .send({ status: "INVALID" })
      .expect(400);

    const updateResponse = await request(app)
      .patch(`/api/hearings/${hearingId}`)
      .set(authed())
      .send({ status: "CANCELLED" })
      .expect(200);
    assertHearingResponse(UpdateHearingResponse, updateResponse.body);
    assert.equal(updateResponse.body.status, "CANCELLED");
    assert.equal(updateResponse.body.effectiveStatus, "CANCELLED");

    const resetResponse = await request(app)
      .patch(`/api/hearings/${hearingId}`)
      .set(authed())
      .send({ status: null })
      .expect(200);
    assertHearingResponse(UpdateHearingResponse, resetResponse.body);
    assert.equal(resetResponse.body.status, null);
    assert.equal(resetResponse.body.effectiveStatus, "UPCOMING");
  });
});