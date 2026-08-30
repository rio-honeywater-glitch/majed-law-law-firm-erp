import puppeteer, { type Browser } from "puppeteer-core";
import { execFileSync } from "node:child_process";

export interface ClientReportPdfBlock {
  type: "heading" | "text" | "links" | "custom";
  title: string;
  content?: string;
  items?: Array<{ label: string; extra?: string }>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Chromium executable not found. Set CHROMIUM_PATH or install chromium.");
  }
}

function renderBlock(block: ClientReportPdfBlock): string {
  const title = escapeHtml(block.title);

  if (block.type === "links" && block.items?.length) {
    const items = block.items
      .map((item) => `
        <li>${escapeHtml(item.label)}${item.extra ? ` <span>(${escapeHtml(item.extra)})</span>` : ""}</li>
      `)
      .join("");
    return `<section class="block"><h2>${title}</h2><ul>${items}</ul></section>`;
  }

  return `
    <section class="block">
      <h2>${title}</h2>
      <p>${escapeHtml(block.content ?? "").replace(/\n/g, "<br>")}</p>
    </section>
  `;
}

function buildClientReportPdfHtml(params: {
  clientName: string;
  reportTitle: string;
  caseNumber?: string | null;
  blocks: ClientReportPdfBlock[];
}): string {
  const issuedOn = new Date().toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const caseRow = params.caseNumber
    ? `<div><strong>رقم القضية:</strong> ${escapeHtml(params.caseNumber)}</div>`
    : "";

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: A4; margin: 20mm 16mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #202020;
        direction: rtl;
        font-family: "Tajawal", "Segoe UI", Tahoma, Arial, sans-serif;
        font-size: 13px;
        line-height: 1.9;
      }
      .masthead {
        background: #121212;
        border-bottom: 4px solid #c9a227;
        color: #ffffff;
        padding: 20px 24px;
        text-align: center;
      }
      .masthead h1 { color: #d5b442; font-size: 20px; line-height: 1.5; margin: 0; }
      .masthead p { color: #c5c5c5; font-size: 10px; margin: 5px 0 0; }
      .report-title {
        border-bottom: 1px solid #e6dfcc;
        font-size: 20px;
        font-weight: 800;
        margin: 0;
        padding: 20px 0 12px;
        text-align: center;
      }
      .accent { background: #c9a227; border-radius: 4px; height: 3px; margin: 10px auto 18px; width: 66px; }
      .meta {
        background: #fbf8ef;
        border: 1px solid #eee3c4;
        border-radius: 8px;
        color: #4b4b4b;
        display: grid;
        gap: 4px;
        margin: 0 0 24px;
        padding: 12px 16px;
      }
      .meta strong { color: #8a6f12; }
      .block { break-inside: avoid; margin: 0 0 20px; }
      .block h2 {
        border-bottom: 2px solid #c9a227;
        color: #161616;
        display: inline-block;
        font-size: 15px;
        margin: 0 0 8px;
        padding: 0 0 5px;
      }
      .block p { color: #303030; margin: 0; }
      .block ul { margin: 0; padding-right: 22px; }
      .block li { margin-bottom: 5px; }
      .block li span { color: #747474; font-size: 11px; }
      footer {
        border-top: 1px solid #e6dfcc;
        color: #777777;
        font-size: 10px;
        margin-top: 32px;
        padding-top: 12px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <header class="masthead">
      <h1>مكتب المحامي<br>ماجد بن سلطان السبيعي</h1>
      <p>للمحاماة والاستشارات القانونية · ترخيص وزارة العدل رقم (42493)</p>
    </header>
    <main>
      <h1 class="report-title">${escapeHtml(params.reportTitle)}</h1>
      <div class="accent"></div>
      <div class="meta">
        <div><strong>العميل:</strong> ${escapeHtml(params.clientName)}</div>
        ${caseRow}
        <div><strong>تاريخ إصدار التقرير:</strong> ${escapeHtml(issuedOn)}</div>
      </div>
      ${params.blocks.map(renderBlock).join("")}
    </main>
    <footer>وثيقة صادرة إلكترونياً من نظام إدارة مكتب المحامي ماجد بن سلطان السبيعي</footer>
  </body>
</html>`;
}

export async function generateClientReportPdf(params: {
  clientName: string;
  reportTitle: string;
  caseNumber?: string | null;
  blocks: ClientReportPdfBlock[];
}): Promise<Buffer> {
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
    await page.setContent(buildClientReportPdfHtml(params), { waitUntil: "load", timeout: 30_000 });
    await page.evaluateHandle("document.fonts.ready");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}