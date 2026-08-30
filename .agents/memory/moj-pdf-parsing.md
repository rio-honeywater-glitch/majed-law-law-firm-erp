---
name: MoJ directory PDF parsing structure
description: How pdf-parse v1 extracts text from the MoJ judicial directory PDF — critical for the parser algorithm.
---

## PDF text structure (after bidi-mark stripping)

Each entry is spread over 1–3 lines:
```
[line N-k..N-1]  Arabic lines: "court_name" + "منطقة X" concatenated (no separator)
                 Sometimes the court name wraps across 2–3 lines.
[line N]         EMAIL@MOJ.GOV.SA   ← always on its OWN line
```

The region name is ALWAYS at the END of the combined Arabic text, concatenated directly to the court name.

## Algorithm that works

1. Strip bidi marks from entire raw text
2. Split into lines; trim each line
3. For each line that matches `^[A-Z0-9._@-]+@MOJ\.GOV\.SA$i`:
   a. Walk backwards collecting up to 5 Arabic lines
   b. Stop at: another email, `^\d+$` (page numbers), `^دليل` (header), `^الجهة$`, `^للجهات`, `^المنطقةالبريد`
4. `combined = parts.join(" ")` (space join to fix wrapped lines)
5. `courtName = combined.slice(0, lastIndexOf(knownRegion)).trim()`
6. If no region found, use entire combined text

## Known regions list (must include all of these for correct stripping)
منطقة الرياض, منطقة عسير, منطقة المدينة المنورة, منطقة الجوف, منطقة القصيم, منطقة تبوك, منطقة جازان, منطقة حائل, منطقة مكة, منطقة نجران, المنطقة الشرقية, المنطقة الشمالية, منطقة الباحة

## Why lastIndexOf not regex

When court names include "بمنطقة X" (e.g., "فرع الوزارة بمنطقة عسير"), the concatenated line is "فرع الوزارة بمنطقة عسيرمنطقة عسير". A greedy regex matches from "بمنطقة" onwards and cuts too much. `lastIndexOf` correctly picks the LAST occurrence of the region name, which is always the actual region suffix.

## Why pdf-parse v1 not v2

pdf-parse v2.x exports a `PDFParse` class (not a default function). The class API is completely different from v1 and requires options. v1 exports a simple `(buffer) => Promise<{text}>` function as the CJS default export — use `(await import("pdf-parse")).default`.

## Result
~2146 unique entries extracted from the official MoJ judicial directory PDF.
