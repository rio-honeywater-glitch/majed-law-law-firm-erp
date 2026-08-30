import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  clientsTable,
  db,
  systemSettingsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { OFFICIAL_SENDER_EMAIL_KEY } from "../lib/mail-settings";
import { buildTestEmailHtml } from "../lib/mailer";

process.env.NODE_ENV = "test";

const originalFetch = globalThis.fetch;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFrom = process.env.RESEND_FROM;
const testApiKey = "re_test_settings_route_key";
const rawProviderMessage = "The domain is not verified for this account";

interface Fixtures {
  tenantId: number;
  managerToken: string;
  technicianToken: string;
  clientEmail: string;
  clientName: string;
}

let fx: Fixtures;
let providerError: { status: number; body: Record<string, unknown> } | null = null;
let sentBodies: Array<Record<string, unknown>> = [];

globalThis.fetch = async (_input, init) => {
  const rawBody = typeof init?.body === "string" ? init.body : "";
  if (rawBody) {
    sentBodies.push(JSON.parse(rawBody) as Record<string, unknown>);
  }

  if (providerError) {
    return new Response(JSON.stringify(providerError.body), {
      status: providerError.status,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ id: "email-settings-test" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { default: app } = await import("../app.js");
const { signToken } = await import("../middlewares/auth.js");

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function sendTestEmail(token: string, to: unknown) {
  return request(app)
    .post("/api/settings/test-email")
    .set(authHeader(token))
    .send({ to });
}

before(async () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const clientEmail = `settings_test_client_${suffix}@example.com`;
  const clientName = `بيانات عميل يجب ألا تظهر ${suffix}`;

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `__test_settings_${suffix}__`, status: "ACTIVE" })
    .returning({ id: tenantsTable.id });
  const [manager] = await db
    .insert(usersTable)
    .values({
      tenantId: tenant!.id,
      email: `settings_manager_${suffix}@example.com`,
      passwordHash: "test-hash",
      role: "SYSTEM_MANAGER",
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  const [technician] = await db
    .insert(usersTable)
    .values({
      tenantId: tenant!.id,
      email: `settings_technician_${suffix}@example.com`,
      passwordHash: "test-hash",
      role: "TECHNICIAN",
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  await db.insert(clientsTable).values({
    tenantId: tenant!.id,
    name: clientName,
    email: clientEmail,
  });
  await db.insert(systemSettingsTable).values({
    tenantId: tenant!.id,
    key: OFFICIAL_SENDER_EMAIL_KEY,
    value: true,
    textValue: `official_sender_${suffix}@example.com`,
  });

  fx = {
    tenantId: tenant!.id,
    managerToken: signToken({
      userId: manager!.id,
      email: manager!.email,
      role: "SYSTEM_MANAGER",
      tenantId: tenant!.id,
    }),
    technicianToken: signToken({
      userId: technician!.id,
      email: technician!.email,
      role: "TECHNICIAN",
      tenantId: tenant!.id,
    }),
    clientEmail,
    clientName,
  };
});

beforeEach(() => {
  providerError = null;
  sentBodies = [];
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalResendApiKey === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = originalResendApiKey;
  }
  if (originalResendFrom === undefined) {
    delete process.env.RESEND_FROM;
  } else {
    process.env.RESEND_FROM = originalResendFrom;
  }
  await db.delete(tenantsTable).where(eq(tenantsTable.id, fx.tenantId));
});

describe("POST /api/settings/test-email security", () => {
  test("rejects unauthenticated requests", async () => {
    await request(app)
      .post("/api/settings/test-email")
      .send({ to: "internal@example.com" })
      .expect(401);

    assert.equal(sentBodies.length, 0);
  });

  test("rejects requests from users who are not system managers", async () => {
    await sendTestEmail(fx.technicianToken, "internal@example.com").expect(403);

    assert.equal(sentBodies.length, 0);
  });

  test("rejects an invalid recipient before checking mail configuration", async () => {
    await sendTestEmail(fx.managerToken, "not-an-email").expect(400);

    assert.equal(sentBodies.length, 0);
  });

  test("does not send to an address registered for a client", async () => {
    process.env.RESEND_API_KEY = testApiKey;

    const response = await sendTestEmail(fx.managerToken, fx.clientEmail.toUpperCase())
      .expect(409);

    assert.match(response.body.error, /لا يمكن إرسال رسالة الاختبار/);
    assert.equal(sentBodies.length, 0);
  });

  test("returns a safe error when the Resend API key is missing", async () => {
    delete process.env.RESEND_API_KEY;

    const response = await sendTestEmail(fx.managerToken, "internal@example.com").expect(503);

    const responseText = JSON.stringify(response.body);
    assert.match(response.body.error, /خدمة البريد غير مهيأة/);
    assert.doesNotMatch(responseText, new RegExp(testApiKey));
    assert.equal(sentBodies.length, 0);
  });

  test("sends a fixed template without reading client details into the message", async () => {
    process.env.RESEND_API_KEY = testApiKey;

    const response = await sendTestEmail(fx.managerToken, "internal@example.com").expect(200);

    assert.equal(response.body.recipient, "internal@example.com");
    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.html, buildTestEmailHtml());
    assert.doesNotMatch(String(sentBodies[0]?.html), new RegExp(fx.clientName));
    assert.doesNotMatch(String(sentBodies[0]?.html), new RegExp(fx.clientEmail));
  });

  test("hides the provider message when the sender domain is not verified", async () => {
    process.env.RESEND_API_KEY = testApiKey;
    providerError = {
      status: 422,
      body: {
        name: "validation_error",
        message: rawProviderMessage,
        statusCode: 422,
      },
    };

    const response = await sendTestEmail(fx.managerToken, "internal@example.com").expect(502);

    const responseText = JSON.stringify(response.body);
    assert.match(response.body.error, /رفض Resend الرسالة/);
    assert.doesNotMatch(responseText, new RegExp(rawProviderMessage));
    assert.doesNotMatch(responseText, new RegExp(testApiKey));
  });
});
