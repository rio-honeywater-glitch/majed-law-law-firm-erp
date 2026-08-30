import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  getBase64AttachmentBytes,
  getTotalMailAttachmentBytes,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MailAttachmentSizeLimitError,
} from "./mailer";

describe("mail attachment size limits", () => {
  test("calculates the decoded size of base64 attachment content", () => {
    const content = Buffer.from("محتوى المستند").toString("base64");

    assert.equal(getBase64AttachmentBytes(content), Buffer.byteLength("محتوى المستند"));
    assert.equal(
      getTotalMailAttachmentBytes([{ content }, { content: Buffer.from("PDF").toString("base64") }]),
      Buffer.byteLength("محتوى المستند") + 3,
    );
  });

  test("exposes the provider limit through a typed error", () => {
    const error = new MailAttachmentSizeLimitError(MAX_TOTAL_ATTACHMENT_BYTES + 1);

    assert.equal(error.resendName, "attachment_size_limit");
    assert.equal(error.totalBytes, MAX_TOTAL_ATTACHMENT_BYTES + 1);
    assert.equal(error.maxBytes, MAX_TOTAL_ATTACHMENT_BYTES);
  });
});