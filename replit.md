# مكتب المحامي ماجد بن سلطان السبيعي — نظام إدارة المكتب

Arabic/RTL legal-practice ERP for a single law firm. One web artifact + one shared API:
- **`law-firm-erp`** (root `/`) — the ERP workspace (login, dashboard, cases, contracts, hearings, tasks, …)
- **`api-server`** (`/api`) — Express API

## Run & Operate

- Workflows run each artifact (`API Server`, `law-firm-erp: web`, `towala-platform: web`) — never `pnpm run dev` at root
- `pnpm run typecheck` — full typecheck (libs first, then leaves); `pnpm run typecheck:libs` after editing `lib/*`
- `pnpm --filter @workspace/api-spec run codegen` — regenerate React Query hooks + Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` — push schema changes (dev only)
- `pnpm --filter @workspace/scripts run backfill-tenants` — idempotent one-shot for pre-multi-tenant DBs: creates legacy tenant, stamps `tenant_id`, enforces NOT NULL/FKs. Run BEFORE `db run push` on populated legacy environments
- Required env: `DATABASE_URL`, `JWT_SECRET` or `SESSION_SECRET` (server hard-fails without), `OPENAI_API_KEY` (AI features), `RESEND_API_KEY` (contract emails)

## Stack

pnpm workspaces · Node 24 · TS 5.9 · Express 5 · PostgreSQL + Drizzle + pgvector · Zod (`zod/v4`) · Orval codegen from `lib/api-spec/openapi.yaml` (contract-first — never edit generated files) · React + Vite + wouter + TanStack Query · TailwindCSS · Arabic RTL (`dir="rtl"`), Tajawal font · esbuild CJS bundle for the server

## Where things live

- `lib/db/src/schema/` — Drizzle schemas: tenants, subscriptions, payments, users, clients, contracts, cases, pleadings, hearings, executions, notifications, tasks, settings, moj_directory, legal_documents/legal_chunks, activity_log
- `lib/api-spec/openapi.yaml` — source of truth for API contracts; `lib/api-client-react/src/generated/api.ts` — generated hooks (do not edit)
- `artifacts/api-server/src/routes/` — auth, dashboard, clients, contracts, cases, pleadings, hearings, executions, notifications, tasks, settings, users, ai, moj-directory, public (checkout), admin (SUPER_ADMIN)
- `artifacts/api-server/src/lib/` — `tenant.ts` (isolation helpers), `cron.ts` (3 jobs), `seed.ts`, `arabic-text.ts` (PDF/RAG pipeline), `contract-pdf.ts`
- `artifacts/api-server/src/middlewares/auth.ts` — JWT + RBAC + tenant-status enforcement
- `artifacts/law-firm-erp/src/pages/` + `components/` — ERP frontend; `artifacts/towala-platform/src/` — Towala frontend

## Multi-tenant architecture

- **Isolation (app layer)**: every firm-owned table has NOT NULL `tenant_id` FK → `tenants`. `scoped(req, tenantCol, ...extra)` on every read/update/delete; `tenantStamp(req)` on every insert + activity_log; child creates re-validate the parent is in-tenant. See `.agents/memory/tenant-isolation.md` for the SUPER_ADMIN write-bypass caveat.
- **Global data**: `moj_directory` is unscoped. AI legal docs are per-firm EXCEPT shared Saudi laws (`tenant_id IS NULL`) — `/api/ai/ask` retrieves `tenant_id IS NULL OR tenant_id = myTenant`.
- **Every user has a numeric `tenantId`** (users.tenant_id NOT NULL, incl. SUPER_ADMIN who owns a "Towala Platform" tenant). SUPER_ADMIN bypasses the tenant filter by ROLE, not by null tenant. `requireAuth` rejects tokens lacking a numeric tenantId (fail-closed).
- **Firm-access enforcement**: tenant.status !== ACTIVE blocks its users — login returns Arabic 403; `requireAuth` (async) re-checks tenant status per request with 15s in-memory TTL cache, fail-closed; SUPER_ADMIN exempt.
- **Cross-artifact session handoff**: both artifacts are same-origin, sharing `localStorage` keys `auth_token`/`auth_user`/`auth_theme`/`auth_branding`. Towala checkout/firm-login store token+theme+branding then full-page `window.location` redirect to ERP `/dashboard`.

## RBAC

- **SUPER_ADMIN** — Towala platform operator. Only role allowed into `/towala/towala-admin` and `/api/admin/*`. Bypasses tenant scoping. Provisioned idempotently on boot by `ensureSuperAdmin()`: env `TOWALA_SUPERADMIN_EMAIL` + `TOWALA_SUPERADMIN_PASSWORD` (both required together); in production bootstrap is SKIPPED if unset (never a static default); dev-only default `superadmin@towala.sa` / `towala123`.
- **SYSTEM_MANAGER** — firm manager. Exclusive: user CRUD, contract fees visibility + PDF generation/send, AI document upload/delete/clear-index, settings, contract editing.
- **TECHNICIAN** — firm staff. Contract `fees` and `pdfUrl` are REDACTED from API responses; `GET /api/users` open to all authenticated users (assignee dropdown) but emails redacted to "" for non-managers.
- Task edit rules: full edits by creator or manager; status toggle also by assignee (or anyone for team-wide); delete by creator or manager.

## Per-tenant identity & theming (ERP)

- `AuthResponse` (login + register-firm) and `GET /auth/me` (`SessionResponse {user, theme, branding}`) carry `branding {name, logoUrl}` + `theme {primaryColor, secondaryColor}` (nullable hex; null = default gold/black).
- Frontend caches in `localStorage` (`auth_branding`, `auth_theme`); `useAuth().branding`; AuthProvider self-heals stale sessions via `getMe()`. Sidebar/navbar/browser-tab all dynamic: `<DocumentBranding>` sets `document.title` = "{firm} | Towala-Legal" + favicon = firm logo; fallbacks: name "مكتب محاماة", Scale icon, title "Towala-Legal | ERP", `public/default-favicon.svg`.
- `<ThemeInjector>` applies theme vars on `document.documentElement` (`useLayoutEffect`, so relative-color border helpers recompute); `buildThemeVars` maps primary → accent vars + contrast-computed foregrounds, secondary → dark sidebar chrome (lightness clamped ≤10%). login.tsx also applies theme directly to avoid a flash.
- At checkout the browser extracts colors from the uploaded logo (`extractLogoColors`: canvas 64×64 sampling, coarse RGB bucketing, skips near-white/black/low-sat; secondary needs hue >40° away); server zod-validates `#RRGGBB`.
- Legacy demo tenant: logo at `law-firm-erp/public/legacy-firm-logo.png` (`tenants.logo_url` points to it; seed sets it); new firms store data-URL logos inline.
- Towala artifact has its own FIXED brand (not per-tenant): light warm-white/orange, orange primary `24 92% 53%`, purple-tinted text — all via `towala-platform/src/index.css` `:root`. Logo lockup in `src/components/towala-logo.tsx` (transparent PNG asset).

## Towala platform (public SaaS surface)

- Routes: `/` marketing landing (pricing 1825 SAR first month / 800 SAR renewal — NO "free setup" wording, per user); `/firm-login` (Towala-branded; SUPER_ADMIN → `/towala-admin`, others → ERP `/dashboard`); `/checkout` mock self-serve signup (dummy card, optional logo upload, `useRegisterFirm`); `/towala-admin` self-contained nest with its own AuthProvider.
- `POST /api/public/register-firm`: email-unique pre-check + single transaction inserting tenant + STANDARD subscription + SETUP payment (MOCK_CARD) + SYSTEM_MANAGER user + `FIRM_REGISTERED` activity; returns 201 AuthResponse.
- **Admin panel** (`routes/admin.ts`, all behind `requireAuth + requireSuperAdmin`): firm list/search/status-filter, firm detail with activate/suspend/cancel, subscription status + editable amounts, renew+extend (1–60 months), payment log + manual payment recording. `resolveCustomerFirm()` excludes platform tenants owning a SUPER_ADMIN; newest subscription per tenant by createdAt desc. Frontend uses only generated hooks + query-key invalidation.

## ERP product notes (active behaviors)

- **Dashboard** — KPI cards incl. green/red WON/LOST case cards → `/cases?outcome=…`; upcoming-hearings card with 7/30/60-day tabs (`?days=` validated, default 7).
- **Cases** — `outcome` enum WON/LOST/PENDING (default PENDING); closing a case REQUIRES choosing an outcome (zod superRefine client + server-enforced in PATCH: outcome only accepted when effective status CLOSED; reopening resets to PENDING). Outcome filter is URL-driven. Case detail tabs URL-driven (`?tab=hearings|executions`, `?hearing=id` scroll/highlight). 4 action modals: edit case, add pleading/hearing/execution.
- **Contracts** — fees + pdfUrl hidden from TECHNICIAN. Manager-only PDF generation (puppeteer-core + system Chromium → `public/uploads/`, served via authed manager-only `GET /api/uploads/:filename`). **Self-healing PDFs**: prod redeploys wipe uploads (ephemeral FS) — send + download routes detect missing file and regenerate (per-contract in-process lock). `custom_clauses` jsonb string[] — create + edit dialogs share `CustomClausesEditor`; server `sanitizeClauses` (max 50 × 2000 chars); rendered in PDF as "بنود إضافية" `<ol start="6">`; editing clauses does NOT auto-regenerate the PDF (toast tells manager).
- **Contract send** — manager-only, emails PDF via Resend (`RESEND_API_KEY`; optional `RESEND_FROM`, default `onboarding@resend.dev`). Arabic 503 if key missing (client cached — restart after env change), 502 with Resend-specific Arabic messages. Until a domain is verified at resend.com/domains, Resend test mode only delivers to the account owner. WhatsApp Cloud API stub commented in route.
- **Hearings** — 48h alert badges + 7-day post-hearing lock; creating a hearing auto-creates a team-wide `HEARING_AUTO` task; rows deep-link to case hearings tab.
- **Tasks** (`/tasks`) — timeframe filters (upper-bound only so overdue stay visible), MANUAL/HEARING_AUTO badges, team-wide = null assignee. Entire module gated by `TASKS_MODULE_VISIBLE` setting (sidebar + redirect + backend 403).
- **Settings** (`/settings`) — manager-only; `PUT /api/settings/:key` allowlisted (only `TASKS_MODULE_VISIBLE`, default true).
- **Users** (`/users`) — manager-only CRUD; bcryptjs; dup email 409; self-delete/self-demotion blocked; blank password on edit keeps current.
- **Executions** — per-case list + global page; POST computes remainingAmount server-side.
- **Notifications** — center + mark-as-read; arrow routes to source (hearing → case tab, execution → /executions, GENERAL → /tasks) and marks read.
- **Shared tables** — `components/ui/sortable-table.tsx` (`useSortable` + `SortableHead`/`IndexHead`): auto "م" column + Arabic localeCompare sort on all major tables; moj-directory keeps server pagination by design.
- **Cron** — 3 boot-started jobs: 48h hearing alerts, 7-day post-hearing lock, 7-day execution reminders.
- **Seed** — `seedIfEmpty()` populates demo data on first boot.

## AI RAG engine (`/ai-assistant`)

- Tables `legal_documents` + `legal_chunks` (pgvector `vector(1536)`, HNSW cosine index). Embeddings: `text-embedding-3-small`; answers: `gpt-4o-mini` with strict answer-only-from-context Arabic system prompt.
- **Requires the user's own `OPENAI_API_KEY`** — Replit AI proxy does NOT support embeddings. Arabic 503 when missing; 404 when nothing indexed.
- **Arabic pipeline** (`arabic-text.ts`): `extractPdfText` = pdfjs-dist legacy build with glyph-position line reconstruction (Y-grouping, RTL X-descending for Arabic-majority lines, gap-based spacing); `fixArabicText` strips BiDi controls, NFKC-normalizes ligatures, detects/reverses visual-order Arabic while preserving LTR runs + mirroring brackets; TXT = strict UTF-8 (`TextDecoder fatal`, BOM strip) → Arabic 400 on bad encoding.
- **Chunking**: split at Arabic sentence boundaries (. ؟ ! ؛ newlines), target 500–1000 tokens (~chars/2.5), 10% sentence overlap, max 1000 chunks per upload.
- **Retrieval**: embed query → cosine top-3 (`<=>`) with tenant filter (`tenant_id IS NULL OR = myTenant`) → `{answer, sources[]}`. `formatSourceText` is DISPLAY-ONLY (never applied before embedding).
- Manager-only: upload (PDF/TXT, multer errors → Arabic 400/413), delete document, clear-index (cascade, logs `LEGAL_INDEX_CLEARED`). Chat open to all users.
- moj-directory PDF upload reuses `extractPdfText` (pdf-parse removed).

## Seed credentials

- SYSTEM_MANAGER: `manager@lawfirm.sa` / `admin123` · TECHNICIAN: `tech@lawfirm.sa` / `tech123`
- SUPER_ADMIN: env-driven (see RBAC); dev default `superadmin@towala.sa` / `towala123`

## User preferences

- No "free setup / تهيئة النظام مجاناً" wording anywhere on the Towala landing; "بدون رسوم اضافية" (not "خفية").
- Landing footer carries only the logo lockup (no login link); header "تسجيل الدخول" → `/firm-login`.

## Gotchas

- After editing `lib/db/` schemas, run `pnpm run typecheck:libs` before leaf typechecks.
- Express 5 `req.params.id` is `string | string[]` — cast: `req.params["id"] as string`.
- Auth middleware exposes `req.auth` (`{userId, email, role}`), NOT `req.user`.
- Deep imports from `@workspace/api-client-react/custom-fetch` are not exported — import from the package root only.
- wouter v3 `<Link>` renders its own `<a>` — never nest an `<a>` inside (className goes on `<Link>`).
- `pdfjs-dist` + `@napi-rs/canvas` must stay in the esbuild `external` list (api-server `build.mjs`) — bundling breaks worker resolution and DOMMatrix.
- Verify artifacts with `pnpm --filter @workspace/<slug> run typecheck`, not `build`; curl via `localhost:80/...` (shared proxy), never service ports.
- Legacy `SMTP_*` secrets are unused (Resend replaced them) and can be deleted.

## Pointers

- `pnpm-workspace` skill — workspace structure, TS setup, package rules
- `.agents/memory/` — tenant isolation caveats, theming, pdfjs bundling, ephemeral-FS lessons
