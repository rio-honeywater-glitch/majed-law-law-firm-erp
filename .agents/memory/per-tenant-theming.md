---
name: Per-tenant theming
description: How the ERP applies each firm's brand colors, and why the injection targets :root.
---
# Per-tenant theming (Towala SaaS)

The `/app/*` ERP re-themes per firm from colors extracted off the uploaded logo.

- **Colors live on `tenants.primaryColor/secondaryColor`** (nullable hex). Null = default gold/black — that IS the graceful fallback (the legacy firm has nulls and looks unchanged).
- **Extraction is client-side** (canvas pixel sampling in `src/lib/theme.ts`), done at checkout because the logo is already in the browser. Avoids adding a server-side image-decode dependency.
- **Theme travels in `AuthResponse.theme`** from BOTH login and register-firm, so every login path (manager, technician, fresh browser with no cache) gets branded.

**Why inject on `document.documentElement` (`:root`), not a wrapper div:** index.css declares relative-color helpers like `--primary-border: hsl(from hsl(var(--primary)) ...)` at `:root`. Overriding `--primary` on a descendant would NOT recompute those `:root`-scoped border vars. Setting the base vars as inline style on the root element (which IS `:root`) makes them recompute correctly. `<ThemeInjector>` clears the vars on unmount/logout so public pages keep the Towala brand.

**How to apply:** any new brand/accent CSS var that should follow the tenant palette must be added to `MANAGED_VARS` in `theme.ts` AND set in `buildThemeVars`, or it will keep the default. Only `/app/*` is themed by design.
