---
name: api-zod DOM lib requirement
description: lib/api-zod needs DOM lib when any OpenAPI schema uses binary format.
---

Add to `lib/api-zod/tsconfig.json` compilerOptions:
```json
"lib": ["ES2022", "DOM"]
```

**Why:** When an OpenAPI schema has `format: binary`, Orval generates `zod.instanceof(File)` in the Zod schema and `file: Blob` in the TypeScript type. Both `File` and `Blob` are DOM globals. The base `tsconfig.base.json` doesn't include DOM lib by default.

**How to apply:** Required once; already applied. If you add new binary-format fields to the spec, no additional change needed.
