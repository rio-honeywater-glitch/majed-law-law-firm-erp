/**
 * Arabic-aware PDF text extraction, BiDi correction, and semantic chunking
 * utilities for the AI Legal Assistant (RAG engine).
 *
 * Problems solved here:
 * 1. Many Arabic PDFs store glyphs in VISUAL order (left-to-right, using Arabic
 *    presentation-form codepoints U+FB50–U+FDFF / U+FE70–U+FEFF). Naive text
 *    extraction yields reversed words with broken ligatures, which destroys
 *    embeddings quality.
 * 2. Naive extractors concatenate PDF text items in content-stream order,
 *    which scrambles RTL line layout.
 * 3. Fixed-size character chunking splits legal terms mid-sentence.
 */

const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const PRESENTATION_FORMS_RE = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

// ─── PDF extraction (pdfjs-dist, position-aware, RTL-aware) ─────────────────

type TextPiece = { str: string; x: number; y: number; width: number };

/**
 * Extracts text from a PDF buffer using pdf.js, reconstructing lines from
 * glyph positions: items are grouped into lines by their Y coordinate, and
 * within each line ordered right-to-left for Arabic lines (left-to-right
 * otherwise). This preserves logical reading order for RTL documents.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();

      const pieces: TextPiece[] = [];
      for (const raw of content.items) {
        const it = raw as { str?: string; transform?: number[]; width?: number };
        if (typeof it.str !== "string" || it.str.trim().length === 0) continue;
        if (!Array.isArray(it.transform)) continue;
        pieces.push({
          str: it.str,
          x: it.transform[4] ?? 0,
          y: it.transform[5] ?? 0,
          width: typeof it.width === "number" ? it.width : 0,
        });
      }

      // Group into lines by Y (PDF origin is bottom-left → sort top to bottom)
      pieces.sort((a, b) => b.y - a.y || a.x - b.x);
      const Y_TOLERANCE = 2.5;
      const lines: TextPiece[][] = [];
      for (const piece of pieces) {
        const current = lines[lines.length - 1];
        if (current && Math.abs(current[0]!.y - piece.y) <= Y_TOLERANCE) {
          current.push(piece);
        } else {
          lines.push([piece]);
        }
      }

      const lineTexts = lines.map((line) => {
        const arabicCount = line.filter((i) => ARABIC_CHAR_RE.test(i.str)).length;
        const isRtl = arabicCount * 2 >= line.length;
        // Reading order: RTL lines are read right→left (descending X)
        line.sort((a, b) => (isRtl ? b.x - a.x : a.x - b.x));

        let text = "";
        let prev: TextPiece | null = null;
        for (const piece of line) {
          if (prev) {
            // Insert a space only when there is a real visual gap between items,
            // so words split across text items are not broken apart.
            const gap = isRtl ? prev.x - (piece.x + piece.width) : piece.x - (prev.x + prev.width);
            text += gap > 1 || /\s$/.test(prev.str) ? " " : "";
          }
          text += piece.str;
          prev = piece;
        }
        return text.trim();
      });

      pages.push(lineTexts.filter((l) => l.length > 0).join("\n"));
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await loadingTask.destroy();
  }
}

// ─── BiDi / reversed-Arabic correction ───────────────────────────────────────

const MIRRORED: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "«": "»",
  "»": "«",
};

/**
 * Heuristically detects whether a line of Arabic text is stored in reversed
 * (visual) order. Signals used:
 * - words ending in "لا" + letter patterns that are the mirror of the definite
 *   article prefix "ال"
 * - words STARTING with taa marbuta "ة" (it can only ever appear word-finally)
 * - words starting with standalone hamza forms that only occur finally
 */
export function looksReversedArabic(line: string): boolean {
  const words = line.split(/\s+/).filter((w) => ARABIC_CHAR_RE.test(w));
  if (words.length === 0) return false;

  let normalScore = 0;
  let reversedScore = 0;
  for (const w of words) {
    // Definite article "ال" at word start → normal logical order
    if (/^ال./u.test(w)) normalScore++;
    // Its mirror image: word ends with "…لا" → likely reversed
    if (/.لا$/u.test(w)) reversedScore++;
    // Taa marbuta can only be word-final in logical order
    if (/^ة/u.test(w)) reversedScore += 2;
    if (/ة./u.test(w)) reversedScore++; // taa marbuta mid-word → scrambled
    // Alef maqsura "ى" is word-final only
    if (/^ى./u.test(w)) reversedScore += 2;
  }
  return reversedScore > normalScore;
}

/**
 * Reverses a visually-ordered line back to logical order, keeping embedded
 * LTR segments (Latin words, numbers, dates) readable and mirroring brackets.
 */
export function reverseVisualLine(line: string): string {
  const flipped = Array.from(line)
    .reverse()
    .map((ch) => MIRRORED[ch] ?? ch)
    .join("");
  // Embedded LTR runs (latin letters / digits with common separators) were
  // reversed too — flip them back to LTR order.
  return flipped.replace(/[A-Za-z0-9]+(?:[.,:/\\-][A-Za-z0-9]+)*/g, (m) =>
    Array.from(m)
      .reverse()
      .map((ch) => MIRRORED[ch] ?? ch)
      .join(""),
  );
}

/**
 * Post-processing pipeline applied to extracted text before embedding:
 * 1. Strips BiDi control characters and BOM.
 * 2. NFKC-normalizes Arabic presentation forms (U+FB50–U+FDFF, U+FE70–U+FEFF)
 *    back to logical letters — repairs broken ligatures (e.g. ﻻ → لا).
 * 3. Detects visually-ordered (reversed) Arabic lines and restores logical
 *    order via string reversal with LTR-run and bracket handling.
 */
export function fixArabicText(raw: string): string {
  const hadPresentationForms = PRESENTATION_FORMS_RE.test(raw);

  const cleaned = raw
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n");

  const lines = cleaned.split("\n");

  // Document-level verdict guides ambiguous short lines: presentation forms
  // strongly suggest visual-order storage.
  const reversedLineCount = lines.filter((l) => looksReversedArabic(l)).length;
  const arabicLineCount = lines.filter((l) => ARABIC_CHAR_RE.test(l)).length;
  const docLooksReversed =
    arabicLineCount > 0 && reversedLineCount / arabicLineCount > (hadPresentationForms ? 0.3 : 0.5);

  const fixed = lines.map((line) => {
    if (!ARABIC_CHAR_RE.test(line)) return line;
    const wordCount = line.split(/\s+/).filter((w) => ARABIC_CHAR_RE.test(w)).length;
    const lineReversed = looksReversedArabic(line);
    // Long lines decide for themselves; short/ambiguous lines follow the document
    const shouldReverse = wordCount >= 3 ? lineReversed : docLooksReversed && !/^ال/u.test(line.trim());
    return shouldReverse ? reverseVisualLine(line) : line;
  });

  return fixed
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Arabic-aware semantic chunking ──────────────────────────────────────────

/**
 * Rough token estimate for mixed Arabic/Latin legal text: OpenAI tokenizers
 * average ~2.5 characters per token for Arabic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.5);
}

// Target 500–1000 tokens per chunk (~1250–2500 chars for Arabic text)
const TARGET_CHUNK_TOKENS = 750;
const MAX_CHUNK_TOKENS = 1000;
const OVERLAP_RATIO = 0.1; // 10% semantic overlap

/**
 * Splits text into sentences at Arabic/Latin sentence boundaries only —
 * periods, Arabic question mark "؟", "!", Arabic semicolon "؛", newlines, and
 * (as a last resort for very long runs) the Arabic comma "،". Legal terms are
 * never split mid-sentence.
 */
export function splitSentences(text: string): string[] {
  const primary = text
    .split(/(?<=[.۔؟!؛])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Break down pathological run-on segments at Arabic commas
  const sentences: string[] = [];
  const MAX_SENTENCE_CHARS = MAX_CHUNK_TOKENS * 2.5;
  for (const s of primary) {
    if (s.length <= MAX_SENTENCE_CHARS) {
      sentences.push(s);
      continue;
    }
    let buf = "";
    for (const part of s.split(/(?<=،)\s*/u)) {
      if (buf && buf.length + part.length + 1 > MAX_SENTENCE_CHARS) {
        sentences.push(buf.trim());
        buf = part;
      } else {
        buf = buf ? `${buf} ${part}` : part;
      }
    }
    if (buf.trim()) sentences.push(buf.trim());
  }
  return sentences;
}

/**
 * Arabic-aware semantic chunker:
 * - splits strictly at sentence boundaries (never mid-term)
 * - targets ~500–1000 tokens per chunk
 * - carries ~10% of trailing sentences into the next chunk as overlap
 */
export function chunkText(raw: string): string[] {
  const text = fixArabicText(raw);
  if (!text) return [];

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const chunk = current.join(" ").trim();
    if (chunk.length > 0) chunks.push(chunk);

    // 10% semantic overlap: seed next chunk with trailing sentences
    const overlapTarget = currentTokens * OVERLAP_RATIO;
    const overlap: string[] = [];
    let overlapTokens = 0;
    for (let i = current.length - 1; i >= 0 && overlapTokens < overlapTarget; i--) {
      overlap.unshift(current[i]!);
      overlapTokens += estimateTokens(current[i]!);
    }
    current = overlap;
    currentTokens = overlapTokens;
  };

  for (const sentence of sentences) {
    const tokens = estimateTokens(sentence);
    if (currentTokens > 0 && currentTokens + tokens > MAX_CHUNK_TOKENS) {
      flush();
    }
    current.push(sentence);
    currentTokens += tokens;
    if (currentTokens >= TARGET_CHUNK_TOKENS) {
      flush();
    }
  }
  // Final flush without seeding overlap
  const tail = current.join(" ").trim();
  const last = chunks[chunks.length - 1];
  if (tail.length > 0 && tail !== last && !(last && last.endsWith(tail))) {
    // Avoid emitting a trailing chunk that is pure overlap of the previous one
    const isPureOverlap = last ? last.includes(tail) : false;
    if (!isPureOverlap) chunks.push(tail);
  }

  return chunks;
}

// ─── Source display formatting ──────────────────────────────────────────────

const ARABIC_LETTER = "\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF";

/**
 * Formats a retrieved chunk for human-readable display in the "Sources"
 * section. Purely presentational — never applied before embedding.
 *
 * Rules:
 * 1. Paragraph break (\n\n) before each standalone occurrence of "المادة".
 * 2. Line break (\n) before numbering patterns like "1." / "٢." / "3)".
 * 3. Ensure a space after sentence punctuation (. ، ؛) — without breaking
 *    decimal numbers like "1.5".
 */
export function formatSourceText(text: string): string {
  let t = text;

  // 3. Space after punctuation. Periods: skip decimals (digit follows) and
  // ellipsis; Arabic comma/semicolon: always ensure a trailing space.
  t = t.replace(/\.(?=[^\s\d.\n])/g, ". ");
  t = t.replace(/([،؛])(?=[^\s\n])/g, "$1 ");

  // 1. Paragraph break before "المادة" as a standalone word (not glued inside
  // a longer Arabic word, and not already at the start of a line).
  t = t.replace(
    new RegExp(`([^\\n])[ \\t]+(?=المادة(?![${ARABIC_LETTER}]))`, "g"),
    "$1\n\n",
  );

  // 2. Line break before list numbering: Western or Arabic-Indic digits
  // followed by "." or ")" then whitespace (decimals like 1.5 don't match
  // because they have no space after the dot).
  t = t.replace(/([^\n])[ \t]+(?=(?:\d{1,3}|[٠-٩]{1,3})[.)][ \t])/g, "$1\n");

  // Tidy: collapse runs of 3+ newlines and trim.
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/**
 * Decodes a plain-text upload as strict UTF-8 (BOM-stripped). Throws if the
 * buffer is not valid UTF-8 so the caller can return a clear Arabic error.
 */
export function decodeUtf8Text(buffer: Buffer): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text: string;
  try {
    text = decoder.decode(buffer);
  } catch {
    throw new Error("INVALID_UTF8");
  }
  return text.replace(/^\uFEFF/, "");
}
