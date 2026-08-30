---
name: Single-firm mode
description: System simplified to a single fixed firm; SaaS layer removed
---

The project was simplified from a multi-tenant SaaS platform to a single-firm ERP for Majed Sultan Al-Subaie Law Firm.

**What was removed:**
- `artifacts/towala-platform` (marketing landing, checkout, admin panel)
- `artifacts/api-server/src/routes/admin.ts` and `routes/public.ts`
- `lib/db/src/schema/subscriptions.ts` and `payments.ts` (tables dropped in DB)
- `ensureSuperAdmin()` from seed.ts and index.ts
- `requireSuperAdmin()` from auth middleware
- SUPER_ADMIN role from AuthPayload type (kept in DB enum to avoid ALTER TYPE complexity)
- SUPER_ADMIN bypass in `scoped()` / tenant.ts

**What remains:**
- `artifacts/law-firm-erp` — the sole ERP frontend at `/`
- `artifacts/api-server` — shared Express API at `/api`
- Roles: SYSTEM_MANAGER and TECHNICIAN only
- `tenants` table still exists with a single row (Majed's firm); tenant status check still enforced
- `DocumentBranding` title hardcoded to "مكتب المحامي ماجد بن سلطان السبيعي | نظام إدارة المكتب"

**Why:** SUPER_ADMIN was kept in the DB user_role enum intentionally — PostgreSQL does not support removing enum values without dropping/recreating the column; since no SUPER_ADMIN users exist, the unused value is harmless.

**How to apply:** Do not re-add public/admin routes or SUPER_ADMIN role without re-adding the tables and the full SaaS auth flow.
