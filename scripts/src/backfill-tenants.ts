/**
 * One-shot, idempotent migration that converts a legacy single-tenant Law Firm
 * ERP database into the multi-tenant schema WITHOUT data loss.
 *
 * Run this on any already-populated environment (e.g. production) BEFORE
 * `pnpm --filter @workspace/db run push`. On a pre-multi-tenant DB, plain
 * `push` would fail because it cannot add NOT NULL `tenant_id` columns to
 * tables that already contain rows. This script:
 *
 *   1. Creates the `tenants` / `subscriptions` tables + enums if missing.
 *   2. Adds a nullable `tenant_id` column to every firm-owned table if missing.
 *   3. Creates a single "legacy" tenant + subscription (only if none exists).
 *   4. Stamps every existing firm-owned row with the legacy tenant id.
 *   5. Enforces NOT NULL + FK on those columns.
 *
 * Shared legal documents (`legal_documents` / `legal_chunks`) intentionally keep
 * `tenant_id` NULL, which makes them GLOBAL Saudi law available to every firm.
 *
 * Re-running is safe: every step is guarded (IF NOT EXISTS / WHERE tenant_id IS
 * NULL / constraint-existence checks).
 *
 * Usage: pnpm --filter @workspace/scripts run backfill-tenants
 */
import { pool } from "@workspace/db";

// Firm-owned tables whose tenant_id must become NOT NULL. `subscriptions` is
// created below already-correct, so it is not in this list.
const FIRM_TABLES = [
  "users",
  "clients",
  "cases",
  "hearings",
  "pleadings",
  "executions",
  "contracts",
  "notifications",
  "activity_log",
  "tasks",
  "system_settings",
] as const;

// Shared-legal tables: tenant_id stays NULLABLE (NULL == global Saudi law).
const LEGAL_TABLES = ["legal_documents", "legal_chunks"] as const;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Enums + new tables ---------------------------------------------------
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE subscription_status AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id serial PRIMARY KEY,
        name text NOT NULL,
        logo_url text,
        primary_color text,
        secondary_color text,
        status tenant_status NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id serial PRIMARY KEY,
        tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan text NOT NULL DEFAULT 'STANDARD',
        first_month_amount numeric(12,2) NOT NULL DEFAULT '1825',
        renewal_amount numeric(12,2) NOT NULL DEFAULT '800',
        status subscription_status NOT NULL DEFAULT 'ACTIVE',
        current_period_start timestamptz NOT NULL DEFAULT now(),
        current_period_end timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 2. Add nullable tenant_id columns everywhere ----------------------------
    for (const t of [...FIRM_TABLES, ...LEGAL_TABLES]) {
      await client.query(
        `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS tenant_id integer;`,
      );
    }

    // 3. Ensure a single legacy tenant + subscription -------------------------
    const existing = await client.query<{ id: number }>(
      "SELECT id FROM tenants ORDER BY id ASC LIMIT 1",
    );
    let legacyTenantId: number;
    if (existing.rows.length > 0) {
      legacyTenantId = existing.rows[0]!.id;
    } else {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
        ["مكتب المحامي ماجد بن سلطان السبيعي"],
      );
      legacyTenantId = inserted.rows[0]!.id;
    }

    const sub = await client.query(
      "SELECT 1 FROM subscriptions WHERE tenant_id = $1 LIMIT 1",
      [legacyTenantId],
    );
    if (sub.rows.length === 0) {
      await client.query(
        `INSERT INTO subscriptions (tenant_id, current_period_end)
         VALUES ($1, now() + interval '30 days')`,
        [legacyTenantId],
      );
    }

    // 4. Stamp all orphan firm-owned rows -------------------------------------
    for (const t of FIRM_TABLES) {
      const res = await client.query(
        `UPDATE ${t} SET tenant_id = $1 WHERE tenant_id IS NULL`,
        [legacyTenantId],
      );
      if (res.rowCount) {
        console.log(`  stamped ${res.rowCount} row(s) in ${t}`);
      }
    }

    // 5. Enforce NOT NULL + FK on firm-owned tables ---------------------------
    for (const t of FIRM_TABLES) {
      await client.query(`ALTER TABLE ${t} ALTER COLUMN tenant_id SET NOT NULL;`);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE ${t}
            ADD CONSTRAINT ${t}_tenant_id_tenants_id_fk
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `);
    }
    // Legal tables: keep tenant_id NULLABLE, just add the FK.
    for (const t of LEGAL_TABLES) {
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE ${t}
            ADD CONSTRAINT ${t}_tenant_id_tenants_id_fk
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `);
    }

    await client.query("COMMIT");
    console.log(
      `Backfill complete. Legacy tenant id = ${legacyTenantId}. ` +
        `Now run: pnpm --filter @workspace/db run push`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    pool.end().finally(() => process.exit(1));
  });
