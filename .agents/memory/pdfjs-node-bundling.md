---
name: pdfjs-dist in bundled Node servers
description: How to make pdfjs-dist work in an esbuild-bundled Node server (DOMMatrix + worker resolution failures)
---

Rule: never bundle `pdfjs-dist` into a Node server build — mark it (and `@napi-rs/canvas`) as esbuild externals and install `@napi-rs/canvas` as a runtime dependency.

**Why:** Two runtime failures occur otherwise: (1) `ReferenceError: DOMMatrix is not defined` — pdf.js's legacy build polyfills DOM globals via an optional dynamic import of `@napi-rs/canvas`, which fails silently when absent; (2) `Cannot find module .../dist/pdf.worker.mjs` — the fake-worker fallback resolves the worker file relative to the importing module, so a bundled entrypoint points to a nonexistent path. Externalizing lets pdf.js resolve its own worker from node_modules.

**How to apply:** When adding PDF parsing with pdfjs-dist to any esbuild/rollup-bundled Node service, add both packages to the `external` list before first run; don't try to polyfill DOMMatrix by hand or copy the worker file into dist.
