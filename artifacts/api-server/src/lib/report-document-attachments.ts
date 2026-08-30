import type { ReportBlock } from "./mailer";

const CASE_DOCUMENT_URL = /^\/api\/cases\/(\d+)\/documents\/(\d+)\/file(?:[?#].*)?$/;

export function extractReportDocumentIds(blocks: ReportBlock[], caseId: number): number[] {
  const ids = new Set<number>();

  for (const block of blocks) {
    if (block.type !== "links") continue;
    for (const item of block.items ?? []) {
      if (!item.url) continue;
      const match = CASE_DOCUMENT_URL.exec(item.url.trim());
      if (!match || Number(match[1]) !== caseId) continue;

      const documentId = Number(match[2]);
      if (Number.isSafeInteger(documentId) && documentId > 0) ids.add(documentId);
    }
  }

  return [...ids];
}