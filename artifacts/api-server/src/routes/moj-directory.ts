import { Router } from "express";
import multer from "multer";
import { requireAuth, requireSystemManager } from "../middlewares/auth";
import { db, mojDirectoryTable } from "@workspace/db";
import { ilike, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { extractPdfText } from "../lib/arabic-text";

const router = Router();

// multer — memory storage, PDF only, 50 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"));
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BIDI_RE = /[\u200F\u200E\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const EMAIL_LINE_RE = /^[A-Z0-9._@\-]+@MOJ\.GOV\.SA$/i;

/**
 * All administrative regions in Saudi Arabia as they appear in the MoJ directory.
 * Used to strip the region suffix from court-name lines where the PDF concatenates
 * "court_name + region" without a separator.
 */
const KNOWN_REGIONS = [
  "منطقة الرياض",
  "منطقة عسير",
  "منطقة المدينة المنورة",
  "منطقة الجوف",
  "منطقة القصيم",
  "منطقة تبوك",
  "منطقة جازان",
  "منطقة حائل",
  "منطقة مكة",
  "منطقة نجران",
  "المنطقة الشرقية",
  "المنطقة الشمالية",
  "منطقة الباحة",
];

/** Strip the last occurrence of a known region from combined Arabic text. */
function stripRegion(combined: string): string {
  let bestIdx = -1;
  for (const region of KNOWN_REGIONS) {
    const idx = combined.lastIndexOf(region);
    if (idx > bestIdx) bestIdx = idx;
  }
  return bestIdx === -1 ? combined.trim() : combined.slice(0, bestIdx).trim();
}

/**
 * Lines that signal a page header / footer — stop collecting Arabic context here.
 */
function isSkipLine(line: string): boolean {
  return (
    /^\d+$/.test(line) ||
    line.startsWith("دليل") ||
    line === "الجهة" ||
    line.startsWith("للجهات") ||
    line.startsWith("المنطقةالبريد")
  );
}

/**
 * Parse text extracted from the MoJ directory PDF.
 *
 * The PDF text structure (after bidi-mark stripping) is:
 *   [line N-k..N-1]  Arabic text lines: court_name + region concatenated (no separator)
 *                    Sometimes the court name wraps to multiple lines.
 *   [line N]         EMAIL@MOJ.GOV.SA  (always on its own line)
 */
function parsePdfText(raw: string): Array<{ courtName: string; emailAddress: string }> {
  const entries: Array<{ courtName: string; emailAddress: string }> = [];
  const seen = new Set<string>();

  const lines = raw
    .replace(BIDI_RE, "")
    .split("\n")
    .map((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!EMAIL_LINE_RE.test(line)) continue;

    const email = line.toUpperCase();
    if (seen.has(email)) continue;

    // Collect Arabic text lines immediately before this email (up to 5 lines back)
    const parts: string[] = [];
    for (let j = i - 1; j >= 0 && parts.length < 5; j--) {
      const prev = lines[j];
      if (!prev) continue;                // skip blank lines
      if (EMAIL_LINE_RE.test(prev)) break; // stop at another email address
      if (isSkipLine(prev)) break;         // stop at page headers / numbers
      parts.unshift(prev);
    }

    if (parts.length === 0) continue;

    // Join with a space so wrapped multi-line names don't concatenate without separator
    const combined = parts.join(" ");
    const courtName = stripRegion(combined);

    if (courtName.length > 3) {
      seen.add(email);
      entries.push({ courtName, emailAddress: email });
    }
  }

  return entries;
}

// ─── GET /api/moj-directory/search ────────────────────────────────────────────

router.get("/search", requireAuth, async (req, res) => {
  const query = (req.query["query"] as string | undefined)?.trim() ?? "";
  const rawLimit = Math.trunc(Number(req.query["limit"]) || 50);
  const rawOffset = Math.trunc(Number(req.query["offset"]) || 0);
  const limit = Math.min(Math.max(rawLimit, 1), 200);
  const offset = Math.max(rawOffset, 0);

  const condition = query
    ? ilike(mojDirectoryTable.courtName, `%${query}%`)
    : sql`TRUE`;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(mojDirectoryTable)
      .where(condition)
      .orderBy(mojDirectoryTable.courtName, mojDirectoryTable.id)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(mojDirectoryTable)
      .where(condition),
  ]);

  res.json({ results: rows, total: count });
});

// ─── POST /api/moj-directory/upload ──────────────────────────────────────────

router.post(
  "/upload",
  requireAuth,
  requireSystemManager,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No PDF file provided" });
      return;
    }

    try {
      const text = await extractPdfText(req.file.buffer);
      const entries = parsePdfText(text);

      if (entries.length === 0) {
        res.status(422).json({ error: "No valid entries found in PDF. Check the file format." });
        return;
      }

      // Truncate existing data and bulk-insert fresh data
      await db.delete(mojDirectoryTable);
      await db.insert(mojDirectoryTable).values(entries);

      logger.info({ inserted: entries.length }, "MoJ directory uploaded");
      res.json({ inserted: entries.length, message: `تم استيراد ${entries.length} جهة بنجاح` });
    } catch (err) {
      logger.error({ err }, "PDF parse error");
      res.status(500).json({ error: "Failed to parse PDF" });
    }
  },
);

export default router;
