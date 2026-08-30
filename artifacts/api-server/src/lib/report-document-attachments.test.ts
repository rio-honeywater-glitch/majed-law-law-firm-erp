import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractReportDocumentIds } from "./report-document-attachments";
import type { ReportBlock } from "./mailer";

describe("extractReportDocumentIds", () => {
  test("extracts unique document IDs belonging to the current case", () => {
    const blocks: ReportBlock[] = [{
      id: "documents",
      type: "links",
      title: "مستندات القضية",
      items: [
        { label: "one", url: "/api/cases/12/documents/34/file" },
        { label: "duplicate", url: "/api/cases/12/documents/34/file?download=1" },
        { label: "two", url: "/api/cases/12/documents/56/file#page=1" },
      ],
    }];

    assert.deepEqual(extractReportDocumentIds(blocks, 12), [34, 56]);
  });

  test("ignores other cases, external URLs, and malformed API paths", () => {
    const blocks: ReportBlock[] = [{
      id: "documents",
      type: "links",
      title: "مستندات القضية",
      items: [
        { label: "other case", url: "/api/cases/99/documents/34/file" },
        { label: "external", url: "https://example.com/document.pdf" },
        { label: "other endpoint", url: "/api/cases/12/documents/34" },
        { label: "invalid id", url: "/api/cases/12/documents/not-a-number/file" },
      ],
    }];

    assert.deepEqual(extractReportDocumentIds(blocks, 12), []);
  });
});