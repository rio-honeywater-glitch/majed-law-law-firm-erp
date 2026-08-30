import puppeteer, { type Browser } from "puppeteer-core";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { logger } from "./logger";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  FULL_REP: "تمثيل قانوني كامل",
  PARTIAL_REP: "تمثيل قانوني جزئي",
  OBJECTION: "اعتراض",
  CASSATION_REQUEST: "طلب تمييز",
  CONTRACT_DRAFTING: "صياغة عقد",
  CONTRACT_REVIEW: "مراجعة عقد",
  LEGAL_CONTRACT_CREATION: "إنشاء عقد قانوني",
  CONSULTATION: "استشارة قانونية",
};

export const UPLOADS_DIR = path.resolve(process.cwd(), "public/uploads");

function resolveChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Chromium executable not found. Set CHROMIUM_PATH or install chromium.");
  }
}

export interface FeeInstallment {
  description: string;
  amount: number;
  refundable: boolean;
}

export interface ContractPdfData {
  id: number;
  seqNumber?: number | null;
  clientName: string;
  clientNationalId?: string | null;
  clientAddress?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  agencyNumber?: string | null;
  agencyEndDate?: string | null;
  agencySource?: string | null;
  serviceType: string;
  hijriDate: string;
  gregorianDate?: string | null;
  caseNumber?: string | null;
  courtName?: string | null;
  caseSubject?: string | null;
  representationScope?: string | null;
  preamble: string | null;
  fees: string | null;
  feeInstallments?: FeeInstallment[] | null;
  isSigned: boolean;
  customClauses: string[];
  createdAt: Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAmount(amount: number): string {
  return `${amount.toLocaleString("ar-SA")} ريالاً سعودياً`;
}

function formatAgencyEndDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return `${escapeHtml(hijri)} هـ الموافق ${escapeHtml(value)}م`;
}

// ─── Fees article ──────────────────────────────────────────────────────────────

function buildFeesArticleHtml(data: ContractPdfData): string {
  const hasInstallments = Array.isArray(data.feeInstallments) && data.feeInstallments.length > 0;

  // Always coerce amounts to numbers to handle JSONB string-number edge cases
  const totalFromInstallments = hasInstallments
    ? data.feeInstallments!.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    : null;

  // Prefer installments total when positive; fall back to the stored fees field
  const baseFees = data.fees ? parseFloat(data.fees) : null;
  const totalFees =
    totalFromInstallments !== null && totalFromInstallments > 0
      ? totalFromInstallments
      : baseFees;

  const totalFormatted = totalFees ? formatAmount(totalFees) : "مبلغ يُتفق عليه";

  let items = "";

  if (hasInstallments) {
    items += `<li>حُدِّدت أتعاب الطرف الأول لقاء توليه للخدمة الموكلة إليه من قبل الطرف الثاني بمبلغ إجمالي قدره <strong>( ${totalFormatted} )</strong> تُدفع وفق الجدول التالي:</li>`;
    data.feeInstallments!.forEach((inst) => {
      const amt = Number(inst.amount) || 0;
      const refundNote =
        inst.refundable === false
          ? " وهي دفعة غير قابلة للاسترداد مقابل الدراسة والاستعداد"
          : "";
      items += `<li>مبلغ <strong>( ${formatAmount(amt)} )</strong> ${escapeHtml(inst.description)}${refundNote}.</li>`;
    });
  } else {
    items += `<li>حُدِّدت أتعاب الطرف الأول لقاء توليه للخدمة الموكلة إليه من قبل الطرف الثاني بمبلغ <strong>( ${totalFormatted} )</strong> تُسدَّد وفق ما يتراضى عليه الطرفان.</li>`;
  }

  items += `<li>يستحق الطرف الأول كامل أتعابه المحددة أعلاه، فور انتهاء القضية سواءً كان ذلك بتنازل الطرف الثاني عنها أو عن طريق الصلح، سواءً كان الصلح بحكم قضائي أو بدون، وسواءً كان بواسطة الطرف الأول أو أي طرف آخر، وسواءً كان الصلح بعد أو قبل مباشرة الدعوى.</li>`;

  return `<div class="terms"><ol>${items}</ol></div>`;
}

// ─── Custom clauses ────────────────────────────────────────────────────────────

function buildCustomClausesHtml(clauses: string[]): string {
  const items = (clauses ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
  if (items.length === 0) return "";
  return `
    <div class="article">
      <div class="article-title">بنود إضافية</div>
      <div class="terms">
        <ol>
          ${items.map((c) => `<li>${escapeHtml(c)}</li>`).join("\n")}
        </ol>
      </div>
    </div>
  `;
}

// ─── Firm logo — read from disk once, cache as data URI ───────────────────────

let _logoDataUri: string | null = null;

function getFirmLogoDataUri(): string {
  if (_logoDataUri) return _logoDataUri;
  const candidates: Array<{ file: string; mime: string }> = [
    // Production build copies the 2000×2000 PNG beside dist/index.mjs.
    { file: path.resolve(__dirname ?? process.cwd(), "firm-logo.png"), mime: "image/png" },
    // pnpm scripts run with the package directory as cwd in development.
    { file: path.resolve(process.cwd(), "src/lib/firm-logo.png"), mime: "image/png" },
    { file: path.resolve(process.cwd(), "public/firm-logo.png"),  mime: "image/png" },
    // Production may run from the workspace root; retain explicit workspace
    // paths as a safe fallback if the deployment layout changes.
    { file: path.resolve(process.cwd(), "artifacts/api-server/src/lib/firm-logo.png"), mime: "image/png" },
    { file: path.resolve(process.cwd(), "artifacts/api-server/public/firm-logo.png"), mime: "image/png" },
    // Legacy JPEGs are intentionally last because they are lower resolution.
    { file: path.resolve(process.cwd(), "src/lib/firm-logo.jpg"),  mime: "image/jpeg" },
    { file: path.resolve(process.cwd(), "src/lib/firm-logo.jpeg"),mime: "image/jpeg" },
    { file: path.resolve(process.cwd(), "public/firm-logo.jpg"),   mime: "image/jpeg" },
    { file: path.resolve(process.cwd(), "public/firm-logo.jpeg"), mime: "image/jpeg" },
    { file: path.resolve(__dirname ?? process.cwd(), "firm-logo.jpg"),  mime: "image/jpeg" },
  ];
  for (const { file, mime } of candidates) {
    if (fs.existsSync(file)) {
      const b64 = fs.readFileSync(file).toString("base64");
      _logoDataUri = `data:${mime};base64,${b64}`;
      return _logoDataUri;
    }
  }
  logger.error("High-resolution firm logo was not found; using fallback logo");
  // Fallback: gold scales SVG if logo file missing
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="58" viewBox="0 0 58 58"><circle cx="29" cy="29" r="27" fill="#1a1a1a" stroke="#c9a227" stroke-width="2.5"/><text x="29" y="36" text-anchor="middle" font-family="Arial" font-size="20" font-weight="bold" fill="#c9a227">&#x645; &#x633;</text></svg>`;
  _logoDataUri = `data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString("base64")}`;
  return _logoDataUri;
}

// ─── Puppeteer header template (repeats on every page) ────────────────────────
// NOTE: Google Fonts are NOT available here; Arial/system fonts are used.
// The template is self-contained HTML with inline styles.

function buildHeaderTemplate(contractNumber: string, dateString: string): string {
  const logoDataUri = getFirmLogoDataUri();

  return `
<style>
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; }
  .hdr {
    width: 100%; height: 100%;
    background-color: #111111 !important;
    background: #111111 !important;
    color: #c9a227;
    box-sizing: border-box;
    padding: 16px 44px 12px;
    border-bottom: 4px solid #c9a227;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: Arial, sans-serif;
    direction: rtl;
    overflow: hidden;
  }
</style>
<div class="hdr">
  <!-- Right: logo + firm name -->
  <div style="display:flex;align-items:center;gap:16px;">
    <img
      src="${logoDataUri}"
      width="98" height="98"
      style="width:98px;height:98px;object-fit:contain;image-rendering:auto;flex-shrink:0;border-radius:50%;border:2px solid #c9a227;background:#111;"
    />
    <div>
      <div style="font-size:18px;font-weight:bold;color:#c9a227;line-height:1.3;letter-spacing:0.3px;">مكتب المحامي ماجد بن سلطان السبيعي</div>
      <div style="font-size:10.5px;color:#a08030;margin-top:3px;letter-spacing:0.6px;">Lawyer Majid Soltan Alsubaeei</div>
      <div style="font-size:10px;color:#a08030;margin-top:2px;">للمحاماة والاستشارات القانونية &nbsp;·&nbsp; ترخيص وزارة العدل رقم (42493)</div>
    </div>
  </div>
  <!-- Left: contract meta -->
  <div style="text-align:left;font-size:11.5px;color:#c9a227;line-height:2.2;direction:rtl;">
    <div>رقم العقد:&nbsp;<b style="color:#e6c65c;font-size:12px;">${escapeHtml(contractNumber)}</b></div>
    <div>التاريخ:&nbsp;<b style="color:#e6c65c;font-size:12px;">${escapeHtml(dateString)}</b></div>
  </div>
</div>`;
}

// ─── Puppeteer footer template (repeats on every page, includes page numbers) ──

function buildFooterTemplate(contractNumber: string): string {
  return `
<style>
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; }
  .ftr {
    width: 100%; height: 100%;
    background-color: #111111 !important;
    background: #111111 !important;
    color: #c9a227;
    box-sizing: border-box;
    padding: 8px 44px 6px;
    border-top: 3px solid #c9a227;
    font-family: Arial, sans-serif;
    font-size: 9.5px;
    text-align: center;
    direction: rtl;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
</style>
<div class="ftr">
  <div style="color:#e6c65c;font-weight:bold;font-size:10.5px;letter-spacing:0.3px;">
    مكتب المحامي ماجد بن سلطان السبيعي &nbsp;·&nbsp; ترخيص وزارة العدل رقم (42493)
  </div>
  <div style="display:flex;justify-content:center;align-items:center;gap:14px;flex-wrap:wrap;color:#a08030;">
    <span>&#128205; 2825 طريق الإمام عبدالله بن سعود — حي الشهداء، الرياض</span>
    <span style="color:#c9a227;">·</span>
    <span>&#128222; 0554430727 / 0547111560</span>
    <span style="color:#c9a227;">·</span>
    <span>&#9993; lawyer.majid@hotmail.com</span>
  </div>
  <div style="color:#7a6020;font-size:8.5px;margin-top:1px;">
    رقم العقد ${escapeHtml(contractNumber)}
    &nbsp;·&nbsp;
    الصفحة <span class="pageNumber" style="color:#e6c65c;font-weight:bold;"></span>
    &nbsp;من&nbsp;
    <span class="totalPages" style="color:#e6c65c;font-weight:bold;"></span>
    &nbsp;·&nbsp;
    وثيقة صادرة إلكترونياً من نظام إدارة الممارسة القانونية
  </div>
</div>`;
}

// ─── Main HTML body (no header/footer — handled by Puppeteer templates) ────────

export function buildContractHtml(data: ContractPdfData): string {
  const serviceLabel = SERVICE_TYPE_LABELS[data.serviceType] ?? data.serviceType;
  const clientName = escapeHtml(data.clientName);
  const hijriDate = escapeHtml(data.hijriDate);
  const gregorianDate = data.gregorianDate ? escapeHtml(data.gregorianDate) : "";

  const dateString = gregorianDate
    ? `${hijriDate} الموافق ${gregorianDate}م`
    : hijriDate;

  // Party 2 detail
  let party2Detail = `<strong>${clientName}</strong>`;
  if (data.clientNationalId) party2Detail += `، سجل مدني رقم: <strong>${escapeHtml(data.clientNationalId)}</strong>`;
  if (data.clientAddress) party2Detail += `، عنوانه: ${escapeHtml(data.clientAddress)}`;
  if (data.clientPhone) party2Detail += `، هاتف: ${escapeHtml(data.clientPhone)}`;
  if (data.clientEmail) party2Detail += `، البريد الإلكتروني: ${escapeHtml(data.clientEmail)}`;
  if (data.agencyNumber) party2Detail += `، رقم الوكالة: <strong>${escapeHtml(data.agencyNumber)}</strong>`;
  if (data.agencyEndDate) party2Detail += `، تاريخ انتهاء الوكالة: <strong>${formatAgencyEndDate(data.agencyEndDate)}</strong>`;
  if (data.agencySource) party2Detail += `، مصدر الوكالة: ${escapeHtml(data.agencySource)}`;

  // Article 1 body
  let article1Body: string;
  if (data.preamble) {
    article1Body = escapeHtml(data.preamble);
  } else {
    let caseRef = "";
    if (data.caseNumber) {
      caseRef = `في متابعة القضية المقيدة بالرقم: <strong>${escapeHtml(data.caseNumber)}</strong>`;
      if (data.courtName) caseRef += ` في ${escapeHtml(data.courtName)}`;
      if (data.caseSubject) caseRef += ` (${escapeHtml(data.caseSubject)})`;
      const scope = data.representationScope ? escapeHtml(data.representationScope) : "حتى صدور حكم نهائي فيها";
      caseRef += `، ${scope}`;
    } else {
      caseRef = `لتقديم خدمة ${escapeHtml(serviceLabel)}`;
      if (data.representationScope) caseRef += `، ${escapeHtml(data.representationScope)}`;
    }
    article1Body = `لما كان الطرف الأول مكتب محاماة مرخص، يُعنى بممارسة نشاط المحاماة والاستشارات الشرعية والقانونية، وما يتفرع عن ذلك من أنشطة، وحيث يرغب الطرف الثاني في توكيل الطرف الأول ${caseRef}، ولما صادفت الطرف الثاني قبولاً لدى الطرف الأول لذا فقد اتفق الطرفان، وهما بكامل الأهلية المعتبرة شرعاً ونظاماً، على إبرام هذا العقد؛ ليحكم العلاقة الناشئة بينهما، ووفقاً للشروط التالية:`;
  }

  const feesArticleHtml = buildFeesArticleHtml(data);
  const customClausesHtml = buildCustomClausesHtml(data.customClauses);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: "Tajawal", "Arial", sans-serif;
    color: #1a1a1a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    background: #fff;
  }

  /* ── Title Band ──────────────────────────────── */
  .title-band {
    text-align: center;
    padding: 22px 48px 8px;
    border-bottom: 1px solid #e5dfd0;
    background: #fffef9;
    break-inside: avoid;
  }
  .title-band h1 {
    font-size: 22px;
    font-weight: 800;
    color: #111111;
  }
  .title-band .rule {
    width: 100px;
    height: 3px;
    background: #c9a227;
    margin: 10px auto 0;
    border-radius: 2px;
  }

  /* ── Content ─────────────────────────────── */
  .content {
    padding: 22px 48px 28px;
  }
  .opening-line {
    font-size: 13.5px;
    line-height: 2;
    color: #2b2b2b;
    margin-bottom: 16px;
    break-inside: avoid;
    orphans: 3;
    widows: 3;
  }

  /* ── Parties ─────────────────────────────── */
  .parties {
    border: 1px solid #e5dfd0;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 22px;
    font-size: 13.5px;
    break-inside: avoid;
  }
  .party-row {
    display: flex;
    border-bottom: 1px solid #e5dfd0;
  }
  .party-row:last-child { border-bottom: none; }
  .party-label-cell {
    background: #111111;
    color: #e6c65c;
    font-weight: 700;
    font-size: 12.5px;
    padding: 12px 16px;
    width: 130px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    line-height: 1.5;
  }
  .party-info-cell {
    padding: 12px 18px;
    color: #2b2b2b;
    line-height: 1.9;
    flex: 1;
  }
  .party-info-cell strong { color: #111; }

  /* ── Articles ────────────────────────────── */
  .article {
    margin-bottom: 18px;
    /*
     * Let a long article continue on the next page. Keeping the whole
     * article together leaves a large unused area when the next article
     * cannot fit in the remaining space.
     */
    break-inside: auto;
    orphans: 3;
    widows: 3;
  }
  .article-title {
    font-size: 14.5px;
    font-weight: 700;
    color: #111;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: underline;
    text-decoration-color: #c9a227;
    text-underline-offset: 5px;
    break-after: avoid;
  }
  .article-title::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #c9a227;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .terms {
    font-size: 13px;
    line-height: 2.1;
    color: #2b2b2b;
    break-inside: auto;
    orphans: 3;
    widows: 3;
  }
  .terms ol {
    padding-right: 22px;
  }
  .terms li {
    margin-bottom: 4px;
    /* Never split one legal paragraph/list item across pages. */
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .preamble-box {
    background: #faf7ef;
    border-right: 4px solid #c9a227;
    border-radius: 6px;
    padding: 14px 18px;
    font-size: 13px;
    line-height: 2.1;
    color: #333;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .copies-box {
    background: #faf7ef;
    border: 1px solid #e5dfd0;
    border-radius: 6px;
    padding: 12px 18px;
    font-size: 13px;
    color: #333;
    text-align: center;
    font-weight: 500;
  }

  /* ── Signatures ───────────────────────────── */
  .signatures {
    display: flex;
    justify-content: space-between;
    gap: 40px;
    margin-top: 32px;
    padding-top: 22px;
    border-top: 1px dashed #d9d2c2;
    break-inside: avoid;
    break-before: auto;
  }
  .sig-box {
    flex: 1;
    text-align: center;
  }
  .sig-box .sig-label {
    font-size: 13px;
    font-weight: 700;
    color: #111;
    margin-bottom: 8px;
  }
  .sig-box .sig-party {
    font-size: 12px;
    color: #444;
    margin-bottom: 54px;
  }
  .sig-box .sig-line {
    border-top: 1.5px solid #c9a227;
    padding-top: 10px;
    font-size: 11px;
    color: #888;
    letter-spacing: 0.3px;
  }
</style>
</head>
<body>

  <!-- ═══ TITLE BAND ═══ -->
  <div class="title-band">
    <h1>عقد أتعاب محاماة — ${escapeHtml(serviceLabel)}</h1>
    <div class="rule"></div>
  </div>

  <!-- ═══ CONTENT ═══ -->
  <div class="content">

    <!-- Opening line -->
    <p class="opening-line">
      إنه في ${dateString} بمدينة الرياض، تمَّ الاتفاق والتراضي بعد توفيق الله بين كل من:
    </p>

    <!-- Parties -->
    <div class="parties">
      <div class="party-row">
        <div class="party-label-cell">الطرف الأول<br/>(المحامي)</div>
        <div class="party-info-cell">
          <strong>المحامي/ ماجد بن سلطان السبيعي</strong>،
          ترخيص وزارة العدل رقم (42493)،
          عنوانه: الرياض — حي الشهداء،
          جوال: 0554430727 / 0547111560،
          الإيميل: lawyer.majid@hotmail.com
        </div>
      </div>
      <div class="party-row">
        <div class="party-label-cell">الطرف الثاني<br/>(الموكل)</div>
        <div class="party-info-cell">${party2Detail}</div>
      </div>
    </div>

    <!-- Article 1 -->
    <div class="article">
      <div class="article-title">المادة الأولى / التمهيد:</div>
      <div class="preamble-box">${article1Body}</div>
    </div>

    <!-- Article 2 -->
    <div class="article">
      <div class="article-title">المادة الثانية / الإيجاب والقبول:</div>
      <div class="preamble-box">
        قَبِلَ الطرف الأول تمثيل الطرف الثاني في الخدمة المحددة في التمهيد أعلاه، فقط ولا يدخل فيها أي خدمة أو قضية متفرعة عنها، والتزم الطرف الأول بأن يبذل في ذلك العناية اللازمة هو والعاملون معه — وفقاً للمبادئ والأعراف المهنية — في الدفاع عن الطرف الثاني، ويشكّل فيها الحق الذي يخدم مصالحه.
      </div>
    </div>

    <!-- Article 3: Fees -->
    <div class="article">
      <div class="article-title">المادة الثالثة / الأتعاب:</div>
      ${feesArticleHtml}
    </div>

    <!-- Article 4 -->
    <div class="article">
      <div class="article-title">المادة الرابعة / أحكام خاصة:</div>
      <div class="terms">
        <ol>
          <li>يُقرّ ويضمن الطرف الثاني صحة دعواه والمعلومات والبيانات والمستندات المقدمة منه للطرف الأول، وفي حالة ثبوت عكس ذلك؛ فيحق للطرف الأول التخلي عن القضية في أي مرحلة مع ثبوت استحقاقه لكامل الأتعاب المتفق عليها وفقاً لما هو محدد في المادة الثالثة.</li>
          <li>يلتزم الطرف الثاني بتزويد الطرف الأول بوكالة شرعية تخوّله إنجاز المهام التي أُوكِلت إليه، ويكون له فيها على وجه الخصوص حق الإقرار وحق توكيل الغير، وكذلك يلتزم الطرف الثاني بتزويد الطرف الأول بجميع المستندات التي تثبت صحة موقفه.</li>
          <li>يتحمّل الطرف الثاني رسوم التكاليف القضائية واتعاب ندب الخبراء وأي رسوم أخرى تتطلبها القضية أو الخدمة إن وجدت.</li>
        </ol>
      </div>
    </div>

    <!-- Article 5 -->
    <div class="article">
      <div class="article-title">المادة الخامسة / أحكام عامة:</div>
      <div class="terms">
        <ol>
          <li>اتفق الطرفان على أن كل المكاتبات والإشعارات المتبادلة بينهما تكون على العناوين الموضحة بصدر هذا العقد، وأن كل ما يُرسَل عليها يكون ملزماً ومنتجاً لآثاره الشرعية والنظامية والتعاقدية.</li>
          <li>يلتزم الطرف الذي يُغيّر عنوانه بإخطار الطرف الآخر بالعنوان الجديد بموجب إشعار كتابي.</li>
        </ol>
      </div>
    </div>

    <!-- Article 6 -->
    <div class="article">
      <div class="article-title">المادة السادسة / نسخ العقد:</div>
      <div class="copies-box">
        حُرِّر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها. &nbsp;&nbsp; « وبالله التوفيق »
      </div>
    </div>

    ${customClausesHtml}

    <!-- Signatures -->
    <div class="signatures">
      <div class="sig-box">
        <div class="sig-label">الطرف الأول — المحامي</div>
        <div class="sig-party">المحامي/ ماجد بن سلطان السبيعي</div>
        <div class="sig-line">التوقيع والختم والتاريخ</div>
      </div>
      <div class="sig-box">
        <div class="sig-label">الطرف الثاني — الموكل</div>
        <div class="sig-party">${clientName}</div>
        <div class="sig-line">التوقيع والتاريخ</div>
      </div>
    </div>

  </div>

</body>
</html>`;
}

// ─── PDF generation lock ───────────────────────────────────────────────────────

const generationLocks = new Map<number, Promise<string>>();

export function generateContractPdf(data: ContractPdfData): Promise<string> {
  const previous = generationLocks.get(data.id) ?? Promise.resolve("");
  const next = previous
    .catch(() => undefined)
    .then(() => generateContractPdfUnlocked(data));
  generationLocks.set(data.id, next);
  next.finally(() => {
    if (generationLocks.get(data.id) === next) {
      generationLocks.delete(data.id);
    }
  }).catch(() => undefined);
  return next;
}

async function generateContractPdfUnlocked(data: ContractPdfData): Promise<string> {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const year = new Date(data.createdAt).getFullYear();
  const seq = data.seqNumber != null ? data.seqNumber : data.id;
  const contractNumber = `C/${String(seq).padStart(4, "0")}/${year}`;
  const hijriDate = data.hijriDate;
  const gregorianDate = data.gregorianDate || "";
  const dateString = gregorianDate
    ? `${hijriDate} الموافق ${gregorianDate}م`
    : hijriDate;

  const html = buildContractHtml(data);
  const headerTemplate = buildHeaderTemplate(contractNumber, dateString);
  const footerTemplate = buildFooterTemplate(contractNumber);

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      executablePath: resolveChromiumPath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });

    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    } as unknown as Parameters<typeof page.setContent>[1]);
    await page.evaluateHandle("document.fonts.ready");

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: {
        top: "155px",
        bottom: "80px",
        left: "0",
        right: "0",
      },
    });

    const token = crypto.randomBytes(8).toString("hex");
    const filename = `contract-${data.id}-${token}.pdf`;

    // Remove stale PDFs for this contract
    const stalePrefix = `contract-${data.id}-`;
    for (const existing of fs.readdirSync(UPLOADS_DIR)) {
      if (existing.startsWith(stalePrefix) && existing.endsWith(".pdf")) {
        fs.rmSync(path.join(UPLOADS_DIR, existing), { force: true });
      }
    }

    fs.writeFileSync(path.join(UPLOADS_DIR, filename), pdfBuffer);
    return `/api/uploads/${filename}`;
  } finally {
    if (browser) {
      await browser.close().catch((err) => {
        logger.warn({ err }, "failed to close puppeteer browser");
      });
    }
  }
}
