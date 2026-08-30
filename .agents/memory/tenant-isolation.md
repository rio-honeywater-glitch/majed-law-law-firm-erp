---
name: Multi-tenant isolation pattern
description: How per-firm data isolation is enforced across the API, and the known SUPER_ADMIN write-bypass footgun.
---

# Multi-tenant isolation (Towala-Legal SaaS)

Every firm-owned table has a NOT NULL `tenant_id` FK to `tenants`. Isolation is enforced in the app layer (not RLS) via two helpers in `api-server/src/lib/tenant.ts`:

- `scoped(req, tenantCol, ...extra)` — builds the WHERE for reads/updates/deletes.
- `tenantStamp(req)` — the `tenant_id` to stamp on inserts (and on `activity_log` rows).

**Rule:** every query touching a firm-owned table must go through `scoped()`, every insert must stamp `tenantStamp()`, and child creates must validate the parent row is in the same tenant (re-fetch the parent with `scoped`). This includes cron-created rows (stamp from the source row's `tenantId`) and PDF-regeneration lookups in `uploads.ts`.

**Deliberately GLOBAL (not scoped):** `moj_directory` (shared MOJ data). AI legal docs are per-firm EXCEPT rows with `tenant_id IS NULL` (shared Saudi laws) — `/api/ai/ask` retrieves `tenant_id IS NULL OR tenant_id = myTenant` (the `visibleChunks` predicate).

## tenantId contract (every user has a numeric one)
`users.tenant_id` is NOT NULL, so EVERY user — including `SUPER_ADMIN` — carries a numeric `tenantId` in its JWT. SUPER_ADMIN is not "firm-less"; it simply lives in some firm row and is not *restricted* to it. Do NOT make requireAuth expect a null tenant for SUPER_ADMIN — that makes SUPER_ADMIN login impossible (token always has a number). Bypass is by ROLE, never by a null tenant.

## Fail-closed rule
`scoped()` keys off `req.auth.role`: `SUPER_ADMIN` → no tenant filter; any other role WITHOUT a numeric `tenantId` → an always-false predicate (`sql\`false\``) so the query returns nothing rather than running unscoped. `requireAuth` rejects (401) any token whose claims violate the contract (unknown role, or `tenantId` not a number) — this invalidates stale pre-multi-tenant tokens still in localStorage. **Why:** auth is app-layer; a stale/forged token must never fall through to an unfiltered query.

## SUPER_ADMIN bypass — footgun
`scoped()` omits the tenant filter for `SUPER_ADMIN` (global read access by design) and **does NOT distinguish read from write**, so a SUPER_ADMIN token also gets global UPDATE/DELETE via ordinary ERP routes. `tenantStamp` no longer blocks them (they have a numeric tenant), so inserts stamp their home tenant. Latent today because no SUPER_ADMIN account exists yet and the ERP CreateUserBody role enum excludes SUPER_ADMIN; when the platform-admin console is built, either block SUPER_ADMIN from ERP mutation routes or split scoping into read-vs-write variants.

## Backfilling an existing (populated) DB
`drizzle-kit push` cannot add NOT NULL `tenant_id` columns to tables that already have rows. For any pre-multi-tenant environment run `pnpm --filter @workspace/scripts run backfill-tenants` FIRST (idempotent: creates tenants/subscriptions + enums, adds nullable columns, creates one legacy tenant, stamps orphan rows, then sets NOT NULL + FKs using drizzle's `<table>_tenant_id_tenants_id_fk` names), THEN `pnpm --filter @workspace/db run push`. Legal tables keep `tenant_id` NULL = global.

**Why:** auth is app-layer, so a forged/over-privileged token bypasses everything. The JWT signing secret must never fall back to a hardcoded value — `auth.ts` hard-fails at startup unless `JWT_SECRET` or `SESSION_SECRET` is set.

**How to apply:** when adding any firm-owned route or table, wire `scoped()` + `tenantStamp()` from the start; when adding SUPER_ADMIN surfaces, do not reuse the firm ERP mutation routes unguarded.
