import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  casesTable,
  clientReportDeliveriesTable,
  clientReportsTable,
  clientsTable,
  db,
  pool,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "re_test_client_report_history";
process.env.RESEND_FROM = "reports@example.com";

type ProviderBehavior = "success" | "failure" | "paused";

interface Fixtures {
  tenantId: number;
  caseId: number;
  clientEmail: string;
  senderName: string;
  token: string;
}

let fx: Fixtures;
let providerBehavior: ProviderBehavior = "success";
let providerEntered: Promise<void>;
let resolveProviderEntered: (() => void) | undefined;
let releaseProvider: (() => void) | undefined;
let providerAcceptedCount = 0;
let providerInvocationCount = 0;
const acceptedProviderAttempts = new Map<string, string>();
const originalFetch = globalThis.fetch;

function resetProvider() {
  providerBehavior = "success";
  providerEntered = new Promise<void>((resolve) => {
    resolveProviderEntered = resolve;
  });
  releaseProvider = undefined;
  providerAcceptedCount = 0;
  providerInvocationCount = 0;
  acceptedProviderAttempts.clear();
}

function authed() {
  return { Authorization: `Bearer ${fx.token}` };
}

function reportData(label: string) {
  return [{
    id: `block-${label}`,
    type: "text" as const,
    title: label,
    content: `محتوى ${label}`,
  }];
}

function sendReport(body: Record<string, unknown>) {
  return request(app)
    .post(`/api/cases/${fx.caseId}/send-report`)
    .set(authed())
    .send(body);
}

globalThis.fetch = async (_input, init) => {
  providerInvocationCount += 1;
  resolveProviderEntered?.();

  if (providerBehavior === "paused") {
    await new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
  }

  if (providerBehavior === "failure") {
    return new Response(JSON.stringify({
      name: "application_error",
      message: "provider unavailable",
      statusCode: 503,
    }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const headers = new Headers(init?.headers);
  const idempotencyKey = headers.get("Idempotency-Key") ?? "";
  let providerMessageId = acceptedProviderAttempts.get(idempotencyKey);
  if (!providerMessageId) {
    providerMessageId = `email-${Date.now()}-${providerAcceptedCount}`;
    acceptedProviderAttempts.set(idempotencyKey, providerMessageId);
    providerAcceptedCount += 1;
  }

  return new Response(JSON.stringify({ id: providerMessageId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { default: app } = await import("../app.js");
const { signToken } = await import("../middlewares/auth.js");

before(async () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const clientEmail = `report_history_${suffix}@example.com`;
  const senderName = "مرسل اختبار التقارير";

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `__test_report_history_${suffix}__`, status: "ACTIVE" })
    .returning({ id: tenantsTable.id });
  const [user] = await db
    .insert(usersTable)
    .values({
      tenantId: tenant!.id,
      email: `report_sender_${suffix}@example.com`,
      passwordHash: "test-hash",
      name: senderName,
      role: "TECHNICIAN",
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  const [client] = await db
    .insert(clientsTable)
    .values({
      tenantId: tenant!.id,
      name: "عميل اختبار سجل الإرسال",
      email: clientEmail,
    })
    .returning({ id: clientsTable.id });
  const [caseRow] = await db
    .insert(casesTable)
    .values({
      tenantId: tenant!.id,
      clientId: client!.id,
      subject: "قضية اختبار سجل إرسال التقرير",
      caseNumber: `REPORT-${suffix}`,
    })
    .returning({ id: casesTable.id });

  fx = {
    tenantId: tenant!.id,
    caseId: caseRow!.id,
    clientEmail,
    senderName,
    token: signToken({
      userId: user!.id,
      email: user!.email,
      role: "TECHNICIAN",
      tenantId: tenant!.id,
    }),
  };
});

beforeEach(() => {
  resetProvider();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await db.delete(tenantsTable).where(eq(tenantsTable.id, fx.tenantId));
});

describe("POST /api/cases/:id/send-report delivery history", () => {
  test("updates the opened saved report after successful delivery", async () => {
    const [saved] = await db
      .insert(clientReportsTable)
      .values({
        tenantId: fx.tenantId,
        caseId: fx.caseId,
        title: "نسخة قديمة",
        reportData: reportData("قديم"),
      })
      .returning({ id: clientReportsTable.id });
    const sentData = reportData("محدّث");

    const response = await sendReport({
      reportId: saved!.id,
      title: "تقرير محدّث",
      reportData: sentData,
      sendAttemptId: crypto.randomUUID(),
    }).expect(200);

    assert.equal(response.body.reportId, saved!.id);
    const [updated] = await db
      .select()
      .from(clientReportsTable)
      .where(eq(clientReportsTable.id, saved!.id))
      .limit(1);
    assert.equal(updated?.title, "تقرير محدّث");
    assert.deepEqual(updated?.reportData, sentData);
    assert.equal(updated?.lastSentTo, fx.clientEmail);
    assert.equal(updated?.lastSentBy, fx.senderName);
    assert.ok(updated?.lastSentAt);
  });

  test("saves a new report after delivering an unsaved report", async () => {
    const title = `تقرير غير محفوظ ${Date.now()}`;
    const sentData = reportData("جديد");

    const response = await sendReport({
      title,
      reportData: sentData,
      sendAttemptId: crypto.randomUUID(),
    }).expect(200);

    const [saved] = await db
      .select()
      .from(clientReportsTable)
      .where(and(
        eq(clientReportsTable.id, response.body.reportId as number),
        eq(clientReportsTable.tenantId, fx.tenantId),
        eq(clientReportsTable.caseId, fx.caseId),
      ))
      .limit(1);
    assert.equal(saved?.title, title);
    assert.deepEqual(saved?.reportData, sentData);
    assert.equal(saved?.lastSentTo, fx.clientEmail);
    assert.ok(saved?.lastSentAt);
  });

  test("preserves delivery history when the saved report is deleted during delivery", async () => {
    const [saved] = await db
      .insert(clientReportsTable)
      .values({
        tenantId: fx.tenantId,
        caseId: fx.caseId,
        title: "تقرير سيحذف أثناء الإرسال",
        reportData: reportData("قبل الحذف"),
      })
      .returning({ id: clientReportsTable.id });
    providerBehavior = "paused";

    const pendingSend = sendReport({
      reportId: saved!.id,
      title: "سجل إرسال محفوظ",
      reportData: reportData("بعد الحذف"),
      sendAttemptId: crypto.randomUUID(),
    }).then((response) => response);

    await providerEntered;
    await request(app)
      .delete(`/api/cases/${fx.caseId}/reports/${saved!.id}`)
      .set(authed())
      .expect(200);
    releaseProvider?.();

    const response = await pendingSend;
    assert.equal(response.status, 200);
    assert.notEqual(response.body.reportId, saved!.id);

    const [replacement] = await db
      .select()
      .from(clientReportsTable)
      .where(eq(clientReportsTable.id, response.body.reportId as number))
      .limit(1);
    assert.equal(replacement?.title, "سجل إرسال محفوظ");
    assert.equal(replacement?.lastSentTo, fx.clientEmail);
    assert.ok(replacement?.lastSentAt);
  });

  test("does not record delivery when the mail provider fails", async () => {
    const [saved] = await db
      .insert(clientReportsTable)
      .values({
        tenantId: fx.tenantId,
        caseId: fx.caseId,
        title: "تقرير قبل فشل المزود",
        reportData: reportData("قبل الفشل"),
      })
      .returning();
    providerBehavior = "failure";

    await sendReport({
      reportId: saved!.id,
      title: "يجب ألا يحفظ",
      reportData: reportData("فشل"),
      sendAttemptId: crypto.randomUUID(),
    }).expect(500);

    const [unchanged] = await db
      .select()
      .from(clientReportsTable)
      .where(eq(clientReportsTable.id, saved!.id))
      .limit(1);
    assert.equal(unchanged?.title, saved!.title);
    assert.deepEqual(unchanged?.reportData, saved!.reportData);
    assert.equal(unchanged?.lastSentAt, null);
    assert.equal(unchanged?.lastSentTo, null);
    assert.equal(unchanged?.lastSentBy, null);
  });

  test("resumes report persistence without sending again after provider acceptance", async () => {
    const [saved] = await db
      .insert(clientReportsTable)
      .values({
        tenantId: fx.tenantId,
        caseId: fx.caseId,
        title: "قبل تعطل الحفظ",
        reportData: reportData("قبل تعطل الحفظ"),
      })
      .returning({ id: clientReportsTable.id });
    const sendAttemptId = crypto.randomUUID();
    const title = `تقرير تعطل حفظه ${Date.now()}`;
    const body = {
      reportId: saved!.id,
      title,
      reportData: reportData("بعد قبول المزود"),
      sendAttemptId,
    };
    const triggerSuffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`.replace(/[^a-zA-Z0-9_]/g, "");
    const functionName = `test_fail_report_save_${triggerSuffix}`;
    const triggerName = `test_fail_report_save_trigger_${triggerSuffix}`;

    await pool.query(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW.title = '${title.replace(/'/g, "''")}' THEN
          RAISE EXCEPTION 'simulated report persistence failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE OR INSERT ON client_reports
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);

    try {
      const firstResponse = await sendReport(body).expect(503);
      assert.equal(firstResponse.body.code, "REPORT_DELIVERY_FINALIZATION_FAILED");
      assert.equal(providerAcceptedCount, 1);
      assert.equal(providerInvocationCount, 1);

      const [acceptedDelivery] = await db
        .select()
        .from(clientReportDeliveriesTable)
        .where(eq(clientReportDeliveriesTable.attemptId, sendAttemptId))
        .limit(1);
      assert.ok(acceptedDelivery?.providerAcceptedAt);
      assert.ok(acceptedDelivery?.providerMessageId);
      assert.equal(acceptedDelivery?.savedReportId, null);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON client_reports`);
      await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    const retryResponse = await sendReport(body).expect(200);
    assert.equal(retryResponse.body.reportId, saved!.id);
    assert.equal(providerAcceptedCount, 1);
    assert.equal(providerInvocationCount, 1);

    const [updated] = await db
      .select()
      .from(clientReportsTable)
      .where(eq(clientReportsTable.id, saved!.id))
      .limit(1);
    assert.equal(updated?.title, title);
    assert.equal(updated?.lastSentTo, fx.clientEmail);
    assert.ok(updated?.lastSentAt);

    const [completedDelivery] = await db
      .select()
      .from(clientReportDeliveriesTable)
      .where(eq(clientReportDeliveriesTable.attemptId, sendAttemptId))
      .limit(1);
    assert.equal(completedDelivery?.savedReportId, saved!.id);
  });
});