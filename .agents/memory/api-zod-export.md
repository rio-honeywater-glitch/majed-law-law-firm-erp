---
name: api-zod export pattern
description: When Orval generates a Zod schema and a TS type with the same name, re-exporting both barrels causes TS2308.
---

Only export the Zod schemas barrel from `lib/api-zod/src/index.ts`:

```ts
export * from "./generated/api";
// Do NOT: export * from "./generated/types"; — causes TS2308 when names clash
```

**Why:** Orval generates `export const UploadXBody = zod.object(...)` in `api.ts` and `export type UploadXBody = { file: Blob }` in `types/`. Re-exporting both with `export *` causes TS2308 even with `export type *`. The types are available from `lib/api-client-react` anyway.

**How to apply:** Any time a new `multipart/form-data` endpoint is added to the OpenAPI spec and codegen is re-run, this pattern must hold.
