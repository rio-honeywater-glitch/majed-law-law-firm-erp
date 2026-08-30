/**
 * Integration tests for the missed-notifications cycle:
 *
 *   GET /api/notifications/missed
 *   POST /api/notifications/missed/acknowledge
 *
 * These tests run against the real DB (DATABASE_URL must be set) so that the
 * full stack — SQL query, monotonic checkpoint update, tenant isolation — is
 * exercised without mocking the persistence layer.
 *
 * Isolation strategy: each test run creates a dedicated tenant, user, and
 * notification set and deletes them in the `after` hook, leaving no permanent
 * side-effects.
 *
 * Run with:
 *   node --import tsx/esm --test src/routes/notifications.missed.test.ts
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { db, tenantsTable, usersTable, notificationsTable, pushFailedNotificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// Must be set before importing app so cron jobs are skipped.
process.env.NODE_ENV = "test";

// Lazy-import the app and signToken after NODE_ENV is set.
const { default: app } = await import("../app.js");
const { signToken } = await import("../middlewares/auth.js");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface Fixtures {
  tenantId: number;
  userId: number;
  token: string;
}

let fx: Fixtures;

/** Create an ACTIVE tenant row and return its id. */
async function createTenant(): Promise<number> {
  const [row] = await db
    .insert(tenantsTable)
    .values({ name: `__test_missed_${Date.now()}__`, status: "ACTIVE" })
    .returning({ id: tenantsTable.id });
  return row!.id;
}

/** Create a user in the given tenant and return its id. */
async function createUser(tenantId: number): Promise<number> {
  const [row] = await db
    .insert(usersTable)
    .values({
      tenantId,
      email: `test_missed_${Date.now()}@example.com`,
      passwordHash: "test-hash",
      role: "TECHNICIAN",
    })
    .returning({ id: usersTable.id });
  return row!.id;
}

/** Seed broadcast notifications for a tenant. Returns the created rows. */
async function seedNotifications(tenantId: number, count = 3) {
  const values = Array.from({ length: count }, (_, i) => ({
    tenantId,
    type: "GENERAL" as const,
    message: `Test notification ${i + 1}`,
    isRead: false as boolean,
  }));
  return db.insert(notificationsTable).values(values).returning();
}

/** Read the current lastMissedAckAt from the DB for the test user. */
async function getLastMissedAckAt(userId: number): Promise<Date | null> {
  const [row] = await db
    .select({ lastMissedAckAt: usersTable.lastMissedAckAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row?.lastMissedAckAt ?? null;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  const tenantId = await createTenant();
  const userId = await createUser(tenantId);
  const token = signToken({
    userId,
    email: "test@example.com",
    role: "TECHNICIAN",
    tenantId,
  });
  fx = { tenantId, userId, token };
});

after(async () => {
  // Delete in dependency order so FK constraints don't block.
  await db
    .delete(pushFailedNotificationsTable)
    .where(eq(pushFailedNotificationsTable.userId, fx.userId));
  await db
    .delete(notificationsTable)
    .where(eq(notificationsTable.tenantId, fx.tenantId));
  await db
    .delete(usersTable)
    .where(eq(usersTable.id, fx.userId));
  await db
    .delete(tenantsTable)
    .where(eq(tenantsTable.id, fx.tenantId));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authed() {
  return { Authorization: `Bearer ${fx.token}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/notifications/missed", () => {
  test("returns all unread notifications when no checkpoint exists (null lastMissedAckAt)", async () => {
    // Ensure no checkpoint is set for the user.
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: null })
      .where(eq(usersTable.id, fx.userId));

    // Seed notifications created after the "session open" moment.
    const seeded = await seedNotifications(fx.tenantId, 3);

    try {
      const res = await request(app)
        .get("/api/notifications/missed")
        .set(authed())
        .expect(200);

      assert.ok(Array.isArray(res.body.items), "items should be an array");
      assert.ok(typeof res.body.cursor === "string", "cursor should be an ISO string");

      // All 3 seeded notifications should appear.
      const returnedIds = res.body.items.map((n: { id: number }) => n.id);
      for (const row of seeded) {
        assert.ok(returnedIds.includes(row.id), `notification ${row.id} should appear`);
      }

      // The cursor must be a valid ISO timestamp.
      assert.ok(!isNaN(Date.parse(res.body.cursor)), "cursor must be a valid date");
    } finally {
      // Clean up seeded notifications.
      await db.delete(notificationsTable).where(eq(notificationsTable.tenantId, fx.tenantId));
    }
  });

  test("returns only notifications created after the checkpoint when lastMissedAckAt is set", async () => {
    // Seed a notification BEFORE setting the checkpoint.
    const [oldNotif] = await seedNotifications(fx.tenantId, 1);

    // Set the checkpoint to now (simulating: user already saw oldNotif).
    const checkpoint = new Date();
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: checkpoint })
      .where(eq(usersTable.id, fx.userId));

    // Wait 1 ms so the next notification's createdAt is strictly after the checkpoint.
    await new Promise((r) => setTimeout(r, 5));

    // Seed a notification AFTER the checkpoint.
    const [newNotif] = await seedNotifications(fx.tenantId, 1);

    try {
      const res = await request(app)
        .get("/api/notifications/missed")
        .set(authed())
        .expect(200);

      const returnedIds = res.body.items.map((n: { id: number }) => n.id);

      assert.ok(!returnedIds.includes(oldNotif!.id), "pre-checkpoint notification should NOT appear");
      assert.ok(returnedIds.includes(newNotif!.id), "post-checkpoint notification should appear");
    } finally {
      await db.delete(notificationsTable).where(eq(notificationsTable.tenantId, fx.tenantId));
      await db.update(usersTable).set({ lastMissedAckAt: null }).where(eq(usersTable.id, fx.userId));
    }
  });

  test("GET alone does NOT advance lastMissedAckAt", async () => {
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: null })
      .where(eq(usersTable.id, fx.userId));

    const before_ = await getLastMissedAckAt(fx.userId);
    assert.equal(before_, null, "checkpoint should start null");

    await request(app)
      .get("/api/notifications/missed")
      .set(authed())
      .expect(200);

    await request(app)
      .get("/api/notifications/missed")
      .set(authed())
      .expect(200);

    const after_ = await getLastMissedAckAt(fx.userId);
    assert.equal(after_, null, "GET alone must not advance lastMissedAckAt");
  });
});

describe("POST /api/notifications/missed/acknowledge", () => {
  test("advances lastMissedAckAt to the cursor returned by GET", async () => {
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: null })
      .where(eq(usersTable.id, fx.userId));

    // Obtain a cursor from GET.
    const getRes = await request(app)
      .get("/api/notifications/missed")
      .set(authed())
      .expect(200);

    const { cursor } = getRes.body as { cursor: string };

    const beforeAck = await getLastMissedAckAt(fx.userId);
    assert.equal(beforeAck, null, "checkpoint should be null before ACK");

    await request(app)
      .post("/api/notifications/missed/acknowledge")
      .set(authed())
      .send({ cursor })
      .expect(200);

    const afterAck = await getLastMissedAckAt(fx.userId);
    assert.ok(afterAck instanceof Date, "checkpoint should now be a Date after ACK");
    assert.equal(
      afterAck.toISOString(),
      new Date(cursor).toISOString(),
      "checkpoint must equal the acknowledged cursor",
    );
  });

  test("subsequent GET returns empty after all notifications are read via the cycle", async () => {
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: null })
      .where(eq(usersTable.id, fx.userId));

    // Seed notifications, fetch, acknowledge, then fetch again.
    const seeded = await seedNotifications(fx.tenantId, 2);

    try {
      const getRes = await request(app)
        .get("/api/notifications/missed")
        .set(authed())
        .expect(200);

      const { cursor, items } = getRes.body as { cursor: string; items: unknown[] };
      assert.equal(items.length, 2, "should see 2 notifications before ACK");

      await request(app)
        .post("/api/notifications/missed/acknowledge")
        .set(authed())
        .send({ cursor })
        .expect(200);

      // No new notifications arrived since the GET cursor, so next GET should be empty.
      const getRes2 = await request(app)
        .get("/api/notifications/missed")
        .set(authed())
        .expect(200);

      assert.equal(
        getRes2.body.items.length,
        0,
        "no missed notifications should appear after the cursor is acknowledged",
      );
    } finally {
      await db.delete(notificationsTable).where(eq(notificationsTable.tenantId, fx.tenantId));
      await db.update(usersTable).set({ lastMissedAckAt: null }).where(eq(usersTable.id, fx.userId));
    }
  });

  test("repeated / concurrent acknowledge calls with the same cursor are idempotent", async () => {
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: null })
      .where(eq(usersTable.id, fx.userId));

    const getRes = await request(app)
      .get("/api/notifications/missed")
      .set(authed())
      .expect(200);

    const { cursor } = getRes.body as { cursor: string };

    // Acknowledge three times concurrently.
    const results = await Promise.all([
      request(app).post("/api/notifications/missed/acknowledge").set(authed()).send({ cursor }),
      request(app).post("/api/notifications/missed/acknowledge").set(authed()).send({ cursor }),
      request(app).post("/api/notifications/missed/acknowledge").set(authed()).send({ cursor }),
    ]);

    for (const r of results) {
      assert.equal(r.status, 200, "all concurrent ACKs should succeed");
    }

    const finalCheckpoint = await getLastMissedAckAt(fx.userId);
    assert.ok(finalCheckpoint instanceof Date, "checkpoint should be set");
    assert.equal(
      finalCheckpoint.toISOString(),
      new Date(cursor).toISOString(),
      "concurrent ACKs must converge to the same checkpoint (monotonic)",
    );
  });

  test("an older cursor cannot roll back the checkpoint (monotonic guarantee)", async () => {
    // Establish a baseline checkpoint in the future relative to 'old' cursor.
    const oldCursorDate = new Date(Date.now() - 10_000); // 10 s ago
    const currentCheckpointDate = new Date(); // "now" — after oldCursorDate

    await db
      .update(usersTable)
      .set({ lastMissedAckAt: currentCheckpointDate })
      .where(eq(usersTable.id, fx.userId));

    // Try to acknowledge with an older cursor — must not regress the checkpoint.
    await request(app)
      .post("/api/notifications/missed/acknowledge")
      .set(authed())
      .send({ cursor: oldCursorDate.toISOString() })
      .expect(200); // endpoint should still return 200

    const checkpoint = await getLastMissedAckAt(fx.userId);
    assert.ok(checkpoint instanceof Date, "checkpoint should still be a Date");
    assert.ok(
      checkpoint.getTime() >= currentCheckpointDate.getTime(),
      "checkpoint must not regress: old cursor must not overwrite a newer checkpoint",
    );
  });

  test("returns 400 when cursor is missing", async () => {
    await request(app)
      .post("/api/notifications/missed/acknowledge")
      .set(authed())
      .send({})
      .expect(400);
  });

  test("returns 400 when cursor is not a valid ISO timestamp", async () => {
    await request(app)
      .post("/api/notifications/missed/acknowledge")
      .set(authed())
      .send({ cursor: "not-a-date" })
      .expect(400);
  });
});

describe("Full missed-notifications cycle (app close → reopen flow)", () => {
  test("simulates: login → notifications created → app closed → reopened → banner shown → acknowledged", async () => {
    // Step 1: Simulate a fresh user with no checkpoint.
    await db
      .update(usersTable)
      .set({ lastMissedAckAt: null })
      .where(eq(usersTable.id, fx.userId));

    // Step 2: Notifications arrive while the app is "closed".
    const missed = await seedNotifications(fx.tenantId, 4);

    try {
      // Step 3: App reopens — mobile calls GET /notifications/missed.
      const getRes = await request(app)
        .get("/api/notifications/missed")
        .set(authed())
        .expect(200);

      const { items, cursor } = getRes.body as { items: { id: number }[]; cursor: string };

      // Banner is shown: all seeded notifications are visible.
      assert.equal(items.length, missed.length, "all missed notifications should appear in the banner");

      const returnedIds = items.map((n) => n.id);
      for (const n of missed) {
        assert.ok(returnedIds.includes(n.id), `notification ${n.id} should be in the banner`);
      }

      // Step 4: lastMissedAckAt has NOT changed after GET.
      const checkpointAfterGet = await getLastMissedAckAt(fx.userId);
      assert.equal(checkpointAfterGet, null, "GET must not advance the checkpoint");

      // Step 5: User taps dismiss — mobile calls POST /notifications/missed/acknowledge.
      await request(app)
        .post("/api/notifications/missed/acknowledge")
        .set(authed())
        .send({ cursor })
        .expect(200);

      // Step 6: Checkpoint has now advanced to the cursor.
      const checkpointAfterAck = await getLastMissedAckAt(fx.userId);
      assert.ok(checkpointAfterAck instanceof Date, "checkpoint must be set after ACK");
      assert.equal(
        checkpointAfterAck.toISOString(),
        new Date(cursor).toISOString(),
        "checkpoint must equal the cursor returned by GET",
      );

      // Step 7: Another GET (next app open) returns empty — no new notifications arrived.
      const getRes2 = await request(app)
        .get("/api/notifications/missed")
        .set(authed())
        .expect(200);

      assert.equal(
        getRes2.body.items.length,
        0,
        "second app open: no missed notifications since the cursor window",
      );
    } finally {
      await db.delete(notificationsTable).where(eq(notificationsTable.tenantId, fx.tenantId));
      await db.update(usersTable).set({ lastMissedAckAt: null }).where(eq(usersTable.id, fx.userId));
    }
  });
});
