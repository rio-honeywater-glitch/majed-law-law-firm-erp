import fs from "fs/promises";
import { Resend } from "resend";
import { logger } from "./logger";

/**
 * Email delivery via the Resend API.
 * Configure via environment variables:
 *   RESEND_API_KEY — Resend API key (required)
 *   RESEND_FROM    — (optional) fallback sender address when a firm has not
 *                    configured an official sender in system settings
 */

export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

export type MailAttachment =
  | { filename: string; path: string }
  | { filename: string; content: Buffer | string };

/** Resend's maximum combined size for all email attachments. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024;

export class MailAttachmentSizeLimitError extends Error {
  readonly resendName = "attachment_size_limit";

  constructor(
    readonly totalBytes: number,
    readonly maxBytes: number = MAX_TOTAL_ATTACHMENT_BYTES,
  ) {
    super("Email attachments exceed the provider's combined size limit");
    this.name = "MailAttachmentSizeLimitError";
  }
}

export function getBase64AttachmentBytes(content: string): number {
  return Buffer.from(content, "base64").length;
}

export function getTotalMailAttachmentBytes(
  attachments: Array<{ content: string }>,
): number {
  return attachments.reduce(
    (total, attachment) => total + getBase64AttachmentBytes(attachment.content),
    0,
  );
}

export interface SendMailOptions {
  from?: string;
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
  idempotencyKey?: string;
}

export interface MailDeliveryReceipt {
  id: string;
}

export async function sendMail(options: SendMailOptions): Promise<MailDeliveryReceipt> {
  if (!isMailerConfigured()) {
    throw new Error("Resend is not configured (RESEND_API_KEY)");
  }
  const from = options.from?.trim() || process.env.RESEND_FROM?.trim();
  if (!from || !isValidEmail(from)) {
    const err = new Error("Official sender email is not configured") as Error & { resendName?: string };
    err.resendName = "missing_from_address";
    throw err;
  }

  const attachments = options.attachments
    ? await Promise.all(options.attachments.map(async (attachment) => {
        const content = "path" in attachment
          ? (await fs.readFile(attachment.path)).toString("base64")
          : Buffer.isBuffer(attachment.content)
            ? attachment.content.toString("base64")
            : attachment.content;
        return { filename: attachment.filename, content };
      }))
    : undefined;

  if (attachments) {
    const totalAttachmentBytes = getTotalMailAttachmentBytes(attachments);
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new MailAttachmentSizeLimitError(totalAttachmentBytes);
    }
  }

  const { data, error } = await getResend().emails.send(
    {
      from: `مكتب المحامي ماجد بن سلطان السبيعي <${from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(attachments ? { attachments } : {}),
    },
    options.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : undefined,
  );

  if (error) {
    logger.error({ resendError: error, to: options.to }, "resend email failed");
    const err = new Error(error.message) as Error & { resendName?: string };
    err.resendName = error.name;
    throw err;
  }

  if (!data?.id) {
    throw new Error("Email provider accepted the request without a message ID");
  }

  logger.info({ emailId: data.id, to: options.to }, "email sent via resend");
  return { id: data.id };
}

export function buildTestEmailHtml(): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
  <div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
    <div style="background:#111111;padding:28px 32px;text-align:center;">
      <h1 style="color:#c9a227;font-size:20px;margin:0;line-height:1.6;">مكتب المحامي<br>ماجد بن سلطان السبيعي</h1>
      <p style="color:#999999;font-size:12px;margin:8px 0 0;">اختبار إعداد البريد الرسمي</p>
    </div>
    <div style="padding:32px;">
      <p style="font-size:16px;color:#222222;margin:0 0 16px;">السلام عليكم ورحمة الله وبركاته،</p>
      <p style="font-size:15px;color:#333333;line-height:1.9;margin:0 0 16px;">
        هذه رسالة اختبار للتأكد من أن إعداد البريد الرسمي يعمل بشكل صحيح.
      </p>
      <p style="font-size:15px;color:#333333;line-height:1.9;margin:0;">
        لم يتم استخدام أي بيانات تخص العملاء في هذه الرسالة.
      </p>
    </div>
    <div style="background:#111111;padding:16px 32px;text-align:center;">
      <p style="color:#777777;font-size:11px;margin:0;line-height:1.8;">
        أُرسلت هذه الرسالة من إعدادات نظام إدارة المكتب.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface ReportBlock {
  id: string;
  type: "heading" | "text" | "links" | "custom";
  title: string;
  content?: string;
  items?: Array<{ label: string; url?: string; extra?: string }>;
}

function renderBlockHtml(block: ReportBlock): string {
  const title = `<h3 style="font-size:14px;font-weight:700;color:#111;margin:0 0 8px;padding-bottom:5px;border-bottom:2px solid #c9a227;display:inline-block;">${escapeHtml(block.title)}</h3>`;

  if (block.type === "links" && block.items?.length) {
    const items = block.items.map(item => {
      const label = escapeHtml(item.label);
      const extra = item.extra ? ` <span style="color:#888;font-size:11px;">(${escapeHtml(item.extra)})</span>` : "";
      return `<li style="margin-bottom:5px;line-height:1.8;">${label}${extra}</li>`;
    }).join("");
    return `<div style="margin-bottom:20px;">${title}<ul style="padding-right:18px;margin:0;">${items}</ul></div>`;
  }

  const content = escapeHtml(block.content ?? "").replace(/\n/g, "<br>");
  return `<div style="margin-bottom:20px;">${title}<p style="font-size:13.5px;line-height:2;color:#333;margin:6px 0 0;">${content}</p></div>`;
}

export function buildClientReportEmailHtml(params: {
  clientName: string;
  reportTitle: string;
  caseNumber?: string | null;
  documentNames?: string[];
}): string {
  const clientName = escapeHtml(params.clientName);
  const reportTitle = escapeHtml(params.reportTitle);
  const caseNumber = params.caseNumber ? escapeHtml(params.caseNumber) : null;
  const dateStr = new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" });
  const documentNames = (params.documentNames ?? []).map(escapeHtml);
  const attachmentSummary = documentNames.length
    ? `<div style="background:#faf7ef;border:1px solid #e8ddb8;border-radius:8px;padding:14px 16px;margin:0 0 6px;color:#5a4a13;font-size:13px;line-height:1.8;">
        <strong>مرفقات الرسالة:</strong> نسخة تقرير القضية بصيغة PDF، ومستندات القضية التالية:
        <ul style="margin:8px 0 0;padding-right:20px;">${documentNames.map(name => `<li>${name}</li>`).join("")}</ul>
      </div>`
    : `<div style="background:#faf7ef;border:1px solid #e8ddb8;border-radius:8px;padding:14px 16px;margin:0 0 6px;color:#5a4a13;font-size:13px;line-height:1.8;">
        <strong>مرفق الرسالة:</strong> نسخة تقرير القضية بصيغة PDF.
      </div>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
  <div style="max-width:660px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">

    <!-- Header -->
    <div style="background:#111111;padding:28px 36px;text-align:center;">
      <h1 style="color:#c9a227;font-size:20px;margin:0 0 4px;line-height:1.6;">مكتب المحامي<br>ماجد بن سلطان السبيعي</h1>
      <p style="color:#999999;font-size:12px;margin:0;">للمحاماة والاستشارات القانونية · ترخيص وزارة العدل رقم (42493)</p>
    </div>

    <!-- Report title bar -->
    <div style="background:#faf7ef;border-bottom:3px solid #c9a227;padding:14px 36px;text-align:center;">
      <p style="font-size:17px;font-weight:700;color:#111;margin:0;">${reportTitle}</p>
      ${caseNumber ? `<p style="font-size:12px;color:#8a7420;margin:4px 0 0;">القضية رقم: ${caseNumber}</p>` : ""}
    </div>

    <!-- Greeting -->
    <div style="padding:28px 36px 12px;">
      <p style="font-size:15px;color:#222;margin:0 0 8px;">السلام عليكم ورحمة الله وبركاته،</p>
      <p style="font-size:15px;color:#333;line-height:1.9;margin:0 0 16px;">
        الأستاذ/ة الكريم/ة <strong>${clientName}</strong>،
      </p>
      <p style="font-size:15px;color:#333;line-height:1.9;margin:0 0 20px;">
        تحية طيبة وبعد،<br>
        نرفق لكم تقرير القضية بصيغة PDF للاطلاع والمتابعة. نأمل منكم التكرم بمراجعته، ويسعدنا الإجابة عن أي استفسار عبر قنوات المكتب الرسمية.
      </p>

      <!-- Meta row -->
      <div style="background:#f5f5f5;border-radius:8px;padding:10px 16px;margin-bottom:24px;font-size:13px;color:#555;">
        <span style="color:#8a7420;font-weight:bold;">تاريخ إصدار التقرير:</span> ${escapeHtml(dateStr)}
      </div>

      ${attachmentSummary}
      <p style="font-size:15px;color:#333;line-height:1.9;margin:20px 0 0;">
        وتفضلوا بقبول فائق الاحترام والتقدير،<br>
        <strong style="color:#111;">مكتب المحامي ماجد بن سلطان السبيعي</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#111111;padding:18px 36px;text-align:center;">
      <p style="color:#777777;font-size:11px;margin:0;line-height:1.9;">
        هذا التقرير صادر إلكترونياً من نظام إدارة مكتب المحامي ماجد بن سلطان السبيعي.<br>
        للاستفسار: تواصل معنا عبر قنواتنا الرسمية.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function buildContractEmailHtml(params: {
  clientName: string;
  serviceTypeLabel: string;
  hijriDate: string;
  contractId: number;
}): string {
  const clientName = escapeHtml(params.clientName);
  const serviceTypeLabel = escapeHtml(params.serviceTypeLabel);
  const hijriDate = escapeHtml(params.hijriDate);
  const { contractId } = params;
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
  <div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
    <div style="background:#111111;padding:28px 32px;text-align:center;">
      <h1 style="color:#c9a227;font-size:20px;margin:0;line-height:1.6;">مكتب المحامي<br>ماجد بن سلطان السبيعي</h1>
      <p style="color:#999999;font-size:12px;margin:8px 0 0;">للمحاماة والاستشارات القانونية</p>
    </div>
    <div style="padding:32px;">
      <p style="font-size:16px;color:#222222;margin:0 0 16px;">السلام عليكم ورحمة الله وبركاته،</p>
      <p style="font-size:15px;color:#333333;line-height:1.9;margin:0 0 16px;">
        الأستاذ/ة الكريم/ة <strong>${clientName}</strong>،
      </p>
      <p style="font-size:15px;color:#333333;line-height:1.9;margin:0 0 20px;">
        يسرّنا أن نرفق لكم نسخة من عقد الخدمات القانونية للاطلاع والمراجعة. نأمل منكم التكرم بمراجعة بنود العقد،
        وفي حال وجود أي استفسار أو ملاحظة، لا تترددوا في التواصل معنا.
      </p>
      <div style="background:#faf7ef;border:1px solid #e8ddb8;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
        <table style="width:100%;font-size:14px;color:#444444;border-collapse:collapse;" dir="rtl">
          <tr><td style="padding:4px 0;color:#8a7420;font-weight:bold;">رقم العقد:</td><td style="padding:4px 0;">${contractId}</td></tr>
          <tr><td style="padding:4px 0;color:#8a7420;font-weight:bold;">نوع الخدمة:</td><td style="padding:4px 0;">${serviceTypeLabel}</td></tr>
          <tr><td style="padding:4px 0;color:#8a7420;font-weight:bold;">التاريخ الهجري:</td><td style="padding:4px 0;">${hijriDate}</td></tr>
        </table>
      </div>
      <p style="font-size:15px;color:#333333;line-height:1.9;margin:0 0 8px;">
        تجدون نسخة العقد مرفقة بصيغة PDF.
      </p>
      <p style="font-size:15px;color:#333333;line-height:1.9;margin:0;">وتفضلوا بقبول فائق الاحترام والتقدير،</p>
      <p style="font-size:15px;color:#111111;font-weight:bold;margin:8px 0 0;">مكتب المحامي ماجد بن سلطان السبيعي</p>
    </div>
    <div style="background:#111111;padding:16px 32px;text-align:center;">
      <p style="color:#777777;font-size:11px;margin:0;line-height:1.8;">
        هذه الرسالة سرية وموجهة للمرسل إليه فقط. إذا وصلتك بالخطأ يرجى حذفها وإبلاغ المرسل.
      </p>
    </div>
  </div>
</body>
</html>`;
}
