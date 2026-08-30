---
name: Contract PDF security model
description: RBAC + serving rules for generated contract PDFs and puppeteer-core quirks
---

## Rule
Generated contract PDFs contain fee data that is redacted from TECHNICIAN, so the whole PDF path is manager-only: generation endpoint, `/api/uploads/:filename` download route (requireAuth + requireSystemManager), and `pdfUrl` in contract list/detail responses (null for technicians).

**Why:** An earlier iteration served PDFs via public `express.static` — architect review flagged it as a fee-redaction bypass (any authed user or URL holder could read fees).

**How to apply:** Any new route or response exposing generated documents must mirror the `fees` redaction and never use unauthenticated static serving. Frontend must fetch PDFs with the Bearer header and open a blob URL (plain `window.open`/`<a href>` sends no JWT).

## Puppeteer quirks (this repo's puppeteer-core version)
- `page.setContent` `waitUntil` typing only accepts `"load" | "domcontentloaded"` (no `networkidle0`); wait for web fonts with `await page.evaluateHandle("document.fonts.ready")`.
- Chromium resolved via `CHROMIUM_PATH` env or `which chromium`; launch needs `--no-sandbox --disable-dev-shm-usage`.
- pdfkit corrupts Arabic text — always render HTML via headless Chromium for Arabic PDFs.
