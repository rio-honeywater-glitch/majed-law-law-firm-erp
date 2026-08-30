import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Plus, Trash2, GripVertical, Printer, Save, FileText,
  ChevronDown, ChevronUp, ExternalLink, ClipboardList, History, Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  clearReportSendAttemptId,
  getOrCreateReportSendAttemptId,
} from "@/lib/client-report-send-attempt";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportBlock {
  id: string;
  type: "heading" | "text" | "links" | "custom";
  title: string;
  content?: string;
  items?: Array<{ label: string; url?: string; extra?: string }>;
}

export interface SavedReport {
  id: number;
  title: string;
  reportData: ReportBlock[];
  createdAt: string;
  lastSentAt?: string | null;
  lastSentTo?: string | null;
  lastSentBy?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  caseId: number;
  caseNumber?: string | null;
  caseSubject?: string | null;
  clientName?: string | null;
  initialReport?: SavedReport | null;
  onReportsChanged?: () => void;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Escape HTML special characters to prevent XSS in document.write contexts. */
function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitise a URL so only safe schemes are rendered as real hrefs.
 * Accepts: /api/... paths, data:application/... , data:image/..., https://, http://
 * Everything else becomes "#".
 */
function safeHref(url: string | null | undefined): string {
  if (!url) return "#";
  const trimmed = url.trim();
  if (trimmed.startsWith("/api/")) return esc(trimmed);
  if (/^data:(application\/|image\/)/.test(trimmed)) return trimmed; // data URIs from pre-fetch — safe
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return esc(trimmed);
  } catch { /* invalid URL */ }
  return "#";
}

/**
 * Pre-fetch a document from the authenticated API and return a data URI.
 * Falls back to the original URL on error so the block still renders.
 */
async function fetchDocAsDataUri(url: string): Promise<string> {
  try {
    const token = localStorage.getItem("auth_token");
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { headers });
    if (!res.ok) return url;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return url; // Non-fatal: keep original URL as fallback
  }
}

/**
 * Walk blocks and resolve any /api/ document links to authenticated data URIs.
 * This must be called before printReport so all links work without a bearer token.
 */
async function resolveDocumentLinks(blocks: ReportBlock[]): Promise<ReportBlock[]> {
  return Promise.all(
    blocks.map(async (block) => {
      if (block.type !== "links" || !block.items?.length) return block;
      const resolvedItems = await Promise.all(
        block.items.map(async (item) => {
          if (!item.url?.startsWith("/api/")) return item;
          const dataUri = await fetchDocAsDataUri(item.url);
          return { ...item, url: dataUri };
        }),
      );
      return { ...block, items: resolvedItems };
    }),
  );
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem("auth_token");
  const headers = new Headers(opts?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Block Editor ─────────────────────────────────────────────────────────────

function BlockCard({
  block,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isDragging,
  dragHandleProps,
}: {
  block: ReportBlock;
  index: number;
  total: number;
  onChange: (b: ReportBlock) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isDragging: boolean;
  dragHandleProps: Record<string, unknown>;
}) {
  return (
    <div
      className={`border rounded-lg bg-card transition-shadow ${isDragging ? "opacity-50 shadow-2xl" : "shadow-sm"}`}
    >
      {/* Block header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        <span
          {...(dragHandleProps as Record<string, React.HTMLAttributes<HTMLSpanElement>>)}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors touch-none"
          title="اسحب لإعادة الترتيب"
        >
          <GripVertical className="w-4 h-4" />
        </span>

        <Input
          dir="rtl"
          className="h-7 text-sm font-semibold bg-transparent border-0 shadow-none px-1 flex-1 focus-visible:ring-1"
          value={block.title}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
          placeholder="عنوان القسم..."
        />

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onMoveUp}
            disabled={index === 0}
          >
            <ChevronUp className="w-3 h-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onMoveDown}
            disabled={index === total - 1}
          >
            <ChevronDown className="w-3 h-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onDelete}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Block body */}
      <div className="p-3">
        {block.type === "links" ? (
          <div className="space-y-1.5">
            {(block.items ?? []).map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <ExternalLink className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-primary font-medium flex-1 truncate">{item.label}</span>
                {item.extra && (
                  <span className="text-xs text-muted-foreground shrink-0">{item.extra}</span>
                )}
              </div>
            ))}
            {(!block.items || block.items.length === 0) && (
              <p className="text-xs text-muted-foreground italic">لا توجد مستندات</p>
            )}
          </div>
        ) : (
          <Textarea
            dir="rtl"
            className="text-sm min-h-[80px] resize-y border-0 shadow-none bg-transparent px-0 focus-visible:ring-0"
            value={block.content ?? ""}
            onChange={(e) => onChange({ ...block, content: e.target.value })}
            placeholder="اكتب محتوى هذا القسم هنا..."
          />
        )}
      </div>
    </div>
  );
}

// ─── Print helper ─────────────────────────────────────────────────────────────

const PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Tajawal", Arial, sans-serif; color: #1a1a1a; background: #fff; direction: rtl; }
  .hdr { background:#111;color:#c9a227;padding:20px 40px 16px;border-bottom:4px solid #c9a227;display:flex;justify-content:space-between;align-items:center; }
  .hdr-title { font-size:20px;font-weight:800; }
  .hdr-sub { font-size:12px;color:#a08030;margin-top:4px; }
  .hdr-meta { text-align:left;font-size:12px;color:#c9a227;line-height:2; }
  .rpt-title { font-size:22px;font-weight:800;text-align:center;padding:24px 40px 8px;border-bottom:1px solid #e5dfd0; }
  .rpt-title::after { content:"";display:block;width:60px;height:3px;background:#c9a227;margin:10px auto 0;border-radius:2px; }
  .content { padding:20px 40px 40px; }
  .block { margin-bottom:20px; }
  .block h3 { font-size:15px;font-weight:700;color:#111;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #c9a227;display:inline-block; }
  .block p { font-size:13.5px;line-height:2.1;color:#2b2b2b;white-space:pre-wrap; }
  .block ul { padding-right:18px; }
  .block li { font-size:13.5px;line-height:2; }
  .footer { border-top:2px solid #c9a227;padding:10px 40px;text-align:center;font-size:11px;color:#888;margin-top:40px; }
  .loading { text-align:center;padding:60px;font-size:16px;color:#666; }
  @media print { .no-print { display:none !important; } }
`;

/** Write the static HTML skeleton into an already-open window. */
function writePrintSkeleton(win: Window) {
  win.document.write(
    `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/>` +
    `<style>${PRINT_CSS}</style></head><body>` +
    `<div class="hdr"><div><div class="hdr-title">مكتب المحامي ماجد بن سلطان السبيعي</div>` +
    `<div class="hdr-sub">Lawyer Majid Soltan Alsubaeei · ترخيص وزارة العدل رقم (42493)</div></div>` +
    `<div class="hdr-meta" id="meta"></div></div>` +
    `<div class="rpt-title" id="rpt-title"></div>` +
    `<div id="content"><div class="loading">جاري تحضير المستندات...</div></div>` +
    `<div class="footer">مكتب المحامي ماجد بن سلطان السبيعي · وثيقة صادرة إلكترونياً من نظام إدارة الممارسة القانونية</div>` +
    `<div class="no-print" id="print-btn-wrap" style="text-align:center;padding:20px;display:none">` +
    `<button id="print-btn" style="background:#c9a227;color:#111;border:none;padding:10px 24px;font-size:14px;cursor:pointer;border-radius:6px;font-family:inherit;font-weight:700;">🖨️ طباعة</button>` +
    `</div></body></html>`,
  );
  win.document.close();
}

/** Populate the already-open print window with resolved block data (DOM only — no innerHTML). */
function populatePrintWindow(
  win: Window,
  blocks: ReportBlock[],
  title: string,
  caseNumber: string | null | undefined,
  clientName: string | null | undefined,
) {
  const doc = win.document;

  // Report title
  const rptTitle = doc.getElementById("rpt-title");
  if (rptTitle) rptTitle.textContent = title;

  // Header meta
  const meta = doc.getElementById("meta");
  if (meta) {
    const addRow = (label: string, value: string) => {
      const div = doc.createElement("div");
      div.textContent = `${label}: `;
      const b = doc.createElement("b");
      b.textContent = value;
      div.appendChild(b);
      meta.appendChild(div);
    };
    if (caseNumber) addRow("القضية", caseNumber);
    if (clientName) addRow("العميل", clientName);
    addRow("التاريخ", new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }));
  }

  // Blocks
  const content = doc.getElementById("content");
  if (content) {
    content.textContent = ""; // Clear loading placeholder
    for (const b of blocks) {
      const blockDiv = doc.createElement("div");
      blockDiv.className = "block";

      const h3 = doc.createElement("h3");
      h3.textContent = b.title;
      blockDiv.appendChild(h3);

      if (b.type === "links" && b.items?.length) {
        const ul = doc.createElement("ul");
        for (const item of b.items) {
          const li = doc.createElement("li");
          li.style.marginBottom = "6px";

          const href = safeHref(item.url);
          if (href !== "#") {
            const a = doc.createElement("a");
            a.href = href;
            a.textContent = item.label;
            a.style.color = "#c9a227";
            a.style.textDecoration = "none";
            li.appendChild(a);
          } else {
            li.appendChild(doc.createTextNode(item.label));
          }

          if (item.extra) {
            const span = doc.createElement("span");
            span.textContent = ` (${item.extra})`;
            span.style.color = "#777";
            span.style.fontSize = "12px";
            li.appendChild(span);
          }
          ul.appendChild(li);
        }
        blockDiv.appendChild(ul);
      } else {
        const p = doc.createElement("p");
        p.textContent = b.content ?? "";
        blockDiv.appendChild(p);
      }

      content.appendChild(blockDiv);
    }
  }

  // Show print button
  const printWrap = doc.getElementById("print-btn-wrap");
  const printBtn = doc.getElementById("print-btn");
  if (printWrap) printWrap.style.display = "";
  if (printBtn && printWrap) {
    printBtn.addEventListener("click", () => {
      printWrap.style.display = "none";
      win.print();
      printWrap.style.display = "";
    });
  }
}

/**
 * Open the print window synchronously (preserving user-activation), write a
 * loading skeleton, resolve auth-protected document links asynchronously, then
 * populate the already-open window with fully resolved content.
 */
async function openPrintWindow(
  blocks: ReportBlock[],
  title: string,
  caseNumber: string | null | undefined,
  clientName: string | null | undefined,
): Promise<void> {
  // Must open synchronously — browsers block window.open from async contexts
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("السماح بالنوافذ المنبثقة مطلوب لمعاينة التقرير");
    return;
  }

  // Write the static skeleton immediately so the user sees feedback
  writePrintSkeleton(win);

  // Resolve authenticated document links asynchronously
  const resolvedBlocks = await resolveDocumentLinks(blocks);

  // Populate the window (already open) with all content
  populatePrintWindow(win, resolvedBlocks, title, caseNumber, clientName);
}

/** Print a saved report from any report list while preserving user activation. */
export async function printSavedReport(
  report: SavedReport,
  caseNumber: string | null | undefined,
  clientName: string | null | undefined,
): Promise<void> {
  await openPrintWindow(report.reportData, report.title, caseNumber, clientName);
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function ClientReportModal({
  open, onClose, caseId, caseNumber, caseSubject, clientName, initialReport, onReportsChanged,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const [reportTitle, setReportTitle] = useState("تقرير موضح للعميل");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sending, setSending] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [view, setView] = useState<"builder" | "saved">("builder");
  const [activeReportId, setActiveReportId] = useState<number | null>(null);

  // Drag state
  const dragIndex = useRef<number | null>(null);
  const dragOverIndex = useRef<number | null>(null);

  // ── Load template on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (initialReport) {
      setBlocks(initialReport.reportData);
      setReportTitle(initialReport.title);
      setActiveReportId(initialReport.id);
      setView("builder");
      setLoading(false);
    } else {
      setActiveReportId(null);
      setLoading(true);
      apiFetch<{ blocks: ReportBlock[] }>(`/api/cases/${caseId}/report-template`)
        .then(({ blocks: b }) => setBlocks(b))
        .catch(() => toast({ variant: "destructive", title: "فشل تحميل بيانات القضية" }))
        .finally(() => setLoading(false));
    }

    loadSavedReports();
  }, [open, caseId, initialReport?.id]);

  const loadSavedReports = useCallback(() => {
    setReportsLoading(true);
    apiFetch<SavedReport[]>(`/api/cases/${caseId}/reports`)
      .then(setSavedReports)
      .catch(() => {})
      .finally(() => setReportsLoading(false));
  }, [caseId]);

  // ── Block operations ──────────────────────────────────────────────────────
  const updateBlock = (i: number, b: ReportBlock) =>
    setBlocks((prev) => prev.map((x, idx) => (idx === i ? b : x)));

  const deleteBlock = (i: number) =>
    setBlocks((prev) => prev.filter((_, idx) => idx !== i));

  const moveUp = (i: number) => {
    if (i === 0) return;
    setBlocks((prev) => {
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  };

  const moveDown = (i: number) => {
    setBlocks((prev) => {
      if (i >= prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
  };

  const addCustomBlock = () => {
    setBlocks((prev) => [
      ...prev,
      { id: genId(), type: "custom", title: "قسم مخصص", content: "" },
    ]);
  };

  // ── Drag-and-drop (HTML5) ─────────────────────────────────────────────────
  const onDragStart = (i: number) => { dragIndex.current = i; };
  const onDragEnter = (i: number) => { dragOverIndex.current = i; };
  const onDragEnd = () => {
    const from = dragIndex.current;
    const to = dragOverIndex.current;
    if (from !== null && to !== null && from !== to) {
      setBlocks((prev) => {
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      });
    }
    dragIndex.current = null;
    dragOverIndex.current = null;
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await apiFetch<SavedReport>(`/api/cases/${caseId}/reports`, {
        method: "POST",
        body: JSON.stringify({ title: reportTitle, reportData: blocks }),
      });
      setActiveReportId(saved.id);
      toast({ title: "✅ تم حفظ التقرير بنجاح" });
      loadSavedReports();
      onReportsChanged?.();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: (err instanceof Error ? err.message : "فشل حفظ التقرير") });
    } finally {
      setSaving(false);
    }
  };

  // ── Send by email ─────────────────────────────────────────────────────────
  const handleSendEmail = async () => {
    if (blocks.length === 0 || !user) return;
    setSending(true);
    const payload = JSON.stringify({
      caseId,
      title: reportTitle,
      reportData: blocks,
      reportId: activeReportId,
    });
    const sendAttemptId = await getOrCreateReportSendAttemptId(
      user.tenantId,
      user.id,
      caseId,
      payload,
    );
    try {
      const result = await apiFetch<{ ok: boolean; reportId: number; sentTo: string }>(
        `/api/cases/${caseId}/send-report`,
        {
          method: "POST",
          body: JSON.stringify({
            title: reportTitle,
            reportData: blocks,
            ...(activeReportId !== null && { reportId: activeReportId }),
            sendAttemptId,
          }),
        },
      );
      await clearReportSendAttemptId(
        user.tenantId,
        user.id,
        caseId,
        payload,
        sendAttemptId,
      );
      setActiveReportId(result.reportId);
      toast({ title: `✅ تم إرسال التقرير إلى ${result.sentTo}` });
      loadSavedReports();
      onReportsChanged?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "فشل إرسال التقرير",
        description: err instanceof Error ? err.message : "تعذر إرسال التقرير. يرجى المحاولة لاحقاً.",
      });
    } finally {
      setSending(false);
    }
  };

  // ── Load saved report into builder ────────────────────────────────────────
  const loadSaved = (r: SavedReport) => {
    setBlocks(r.reportData);
    setReportTitle(r.title);
    setActiveReportId(r.id);
    setView("builder");
  };

  // ── Delete saved report ───────────────────────────────────────────────────
  const deleteSaved = async (reportId: number) => {
    try {
      await apiFetch(`/api/cases/${caseId}/reports/${reportId}`, { method: "DELETE" });
      setSavedReports((prev) => prev.filter((r) => r.id !== reportId));
      setActiveReportId((current) => current === reportId ? null : current);
      toast({ title: "تم حذف التقرير" });
      onReportsChanged?.();
    } catch {
      toast({ variant: "destructive", title: "فشل حذف التقرير" });
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-3xl w-full max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b bg-muted/30 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary" />
              {initialReport ? "فتح التقرير المحفوظ" : "إنشاء تقرير للعميل"}
            </DialogTitle>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={view === "builder" ? "default" : "ghost"}
                className="gap-1.5 h-8 text-xs"
                onClick={() => setView("builder")}
              >
                <FileText className="w-3.5 h-3.5" />
                البناء
              </Button>
              <Button
                size="sm"
                variant={view === "saved" ? "default" : "ghost"}
                className="gap-1.5 h-8 text-xs"
                onClick={() => { setView("saved"); loadSavedReports(); }}
              >
                <History className="w-3.5 h-3.5" />
                المحفوظة ({savedReports.length})
              </Button>
            </div>
          </div>

          {/* Case meta pill */}
          {(caseNumber || caseSubject) && (
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              {caseNumber && <Badge variant="outline" className="text-xs">{caseNumber}</Badge>}
              {caseSubject && <span className="truncate">{caseSubject}</span>}
            </div>
          )}
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Builder view ──────────────────────────── */}
          {view === "builder" && (
            <div className="p-5 space-y-4">
              {/* Report title input */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium shrink-0">عنوان التقرير</label>
                <Input
                  dir="rtl"
                  className="h-8 text-sm"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  placeholder="عنوان التقرير..."
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-3">
                  {blocks.map((block, i) => (
                    <div
                      key={block.id}
                      draggable
                      onDragStart={() => onDragStart(i)}
                      onDragEnter={() => onDragEnter(i)}
                      onDragEnd={onDragEnd}
                      onDragOver={(e) => e.preventDefault()}
                    >
                      <BlockCard
                        block={block}
                        index={i}
                        total={blocks.length}
                        onChange={(b) => updateBlock(i, b)}
                        onDelete={() => deleteBlock(i)}
                        onMoveUp={() => moveUp(i)}
                        onMoveDown={() => moveDown(i)}
                        isDragging={false}
                        dragHandleProps={{
                          draggable: false,
                          onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
                        }}
                      />
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    className="w-full gap-2 border-dashed border-2 h-10 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                    onClick={addCustomBlock}
                  >
                    <Plus className="w-4 h-4" />
                    إضافة قسم مخصص
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Saved reports view ────────────────────── */}
          {view === "saved" && (
            <div className="p-5">
              {reportsLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : savedReports.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <History className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">لا توجد تقارير محفوظة لهذه القضية</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedReports.map((r) => (
                    <div
                      key={r.id}
                      className="border rounded-lg p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors"
                    >
                      <ClipboardList className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{r.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(r.createdAt).toLocaleDateString("ar-SA", {
                            year: "numeric", month: "long", day: "numeric",
                          })}
                          {" · "}
                          {r.reportData.length} قسم
                        </p>
                        {r.lastSentAt && (
                          <p className="text-xs text-emerald-700 mt-1 break-words">
                            أُرسل في {new Date(r.lastSentAt).toLocaleDateString("ar-SA", {
                              year: "numeric", month: "long", day: "numeric",
                            })}
                            {r.lastSentTo ? ` إلى ${r.lastSentTo}` : ""}
                            {r.lastSentBy ? ` بواسطة ${r.lastSentBy}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1"
                          onClick={() => loadSaved(r)}
                        >
                          <FileText className="w-3 h-3" />
                          فتح
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          onClick={() => deleteSaved(r.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {view === "builder" && (
          <DialogFooter className="px-6 py-4 border-t bg-muted/20 shrink-0 gap-2 flex-wrap">
            <Button variant="outline" onClick={onClose} className="h-9">
              إغلاق
            </Button>
            <Button
              variant="outline"
              className="gap-2 h-9"
              disabled={blocks.length === 0 || printing}
              onClick={() => {
                setPrinting(true);
                openPrintWindow(blocks, reportTitle, caseNumber, clientName)
                  .finally(() => setPrinting(false));
              }}
            >
              {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              معاينة وطباعة
            </Button>
            <Button
              className="gap-2 h-9"
              disabled={saving || blocks.length === 0}
              onClick={handleSave}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              حفظ التقرير
            </Button>
            <Button
              variant="outline"
              className="gap-2 h-9 text-blue-700 border-blue-200 hover:bg-blue-50 hover:border-blue-400"
              disabled={sending || blocks.length === 0}
              onClick={handleSendEmail}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              إرسال إلى بريد العميل
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
