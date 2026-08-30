---
name: pdf-parse v2 ESM import
description: pdf-parse v2 is ESM-native and has no .default export; requires type casting to bypass TypeScript strict ESM types.
---

**Pattern to use in server route:**
```ts
type PdfParseResult = { text: string; numpages: number };
type PdfParseFunc = (input: Buffer) => Promise<PdfParseResult>;
const pdfParse = (await import("pdf-parse")) as unknown as PdfParseFunc;
const { text } = await pdfParse(buffer);
```

**Why:** `pdf-parse@2.x` exports its parse function as the ESM module itself (no `.default`). TypeScript's `typeof import(...)` reflects this literally, so `{ default: pdfParse }` destructuring fails at compile time. The double-cast `as unknown as PdfParseFunc` is the cleanest escape hatch.

**How to apply:** Any route that imports pdf-parse dynamically should use this pattern.
