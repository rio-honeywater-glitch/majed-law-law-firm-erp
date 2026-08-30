import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useSearch, useLocation } from "wouter";
import {
  useGetCase, getGetCaseQueryKey, useUpdateCase,
  useListPleadings, getListPleadingsQueryKey, useCreatePleading,
  useListHearings, getListHearingsQueryKey, useCreateHearing, useUpdateHearing,
  useListExecutions, getListExecutionsQueryKey, useCreateExecution,
  useListCaseDocuments, useUploadCaseDocument, useUpdateCaseDocument, useDeleteCaseDocument,
  getListCaseDocumentsQueryKey,
  getListCasesQueryKey,
  useDeleteCase,
} from "@workspace/api-client-react";
import type { CaseDocument, HearingUpdateStatus } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ArrowRight, FileText, Scale, Gavel, FileEdit, FolderOpen, Upload, Download, Trash2, FileBadge, Eye, ShieldAlert, User, X, OctagonX, Pencil, Save, Link2, ClipboardList, DollarSign, CheckCircle2, Clock, Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { JurisdictionSelectItems, CLIENT_ROLE_LABELS, opponentRoleLabel } from "./cases";
import { HijriDatePicker, hijriToGregorian } from "@/components/ui/hijri-date-picker";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import ClientReportModal, { printSavedReport } from "@/components/ClientReportModal";
import type { SavedReport } from "@/components/ClientReportModal";

const editCaseSchema = z
  .object({
    caseNumber: z.string().optional(),
    subject: z.string().min(1, "موضوع القضية مطلوب"),
    clientRole: z.enum(["PLAINTIFF", "DEFENDANT"]).optional(),
    opponentName: z.string().optional(),
    jurisdiction: z.string().optional(),
    status: z.enum(["UNDER_REVIEW", "APPEAL", "EXECUTION", "CLOSED"]),
    outcome: z.enum(["WON", "LOST", "PENDING"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "CLOSED" && data.outcome !== "WON" && data.outcome !== "LOST") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome"],
        message: "الرجاء تحديد نتيجة القضية عند إغلاقها",
      });
    }
  });
type EditCaseFormValues = z.infer<typeof editCaseSchema>;

const pleadingSchema = z.object({
  type: z.string().min(1, "نوع المذكرة مطلوب"),
  content: z.string().min(1, "محتوى المذكرة مطلوب"),
  status: z.enum(["DRAFT", "SUBMITTED"]),
});
type PleadingFormValues = z.infer<typeof pleadingSchema>;

const hearingSchema = z.object({
  hijriDate: z.string().min(1, "التاريخ الهجري مطلوب"),
  hearingTime: z.string().min(1, "وقت الجلسة مطلوب"),
  attendance: z.string().optional(),
  requiresLawsuitEditing: z.boolean(),
  requiresReplyPrep: z.boolean(),
  sessionLink: z.string().url("رابط غير صالح").or(z.literal("")).optional(),
});
type HearingFormValues = z.infer<typeof hearingSchema>;

const executionSchema = z.object({
  executionNumber: z.string().optional(),
  type: z.string().optional(),
  totalAmount: z.string().min(1, "المبلغ الإجمالي مطلوب").refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, "قيمة غير صالحة"),
  paidAmount: z.string().refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "قيمة غير صالحة"),
});
type ExecutionFormValues = z.infer<typeof executionSchema>;

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "error" in err && typeof (err as { error: unknown }).error === "string") {
    return (err as { error: string }).error;
  }
  return fallback;
}

export default function CaseDetail() {
  const params = useParams();
  const caseId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(search);
  const urlTab = searchParams.get("tab");
  const hearingParam = searchParams.get("hearing");
  const parsedHearingId = hearingParam ? Number(hearingParam) : NaN;
  const focusHearingId = Number.isFinite(parsedHearingId) ? parsedHearingId : null;

  const NAMED_TABS = new Set(["hearings", "executions", "documents", "description", "financial", "reports"]);
  const [activeTab, setActiveTab] = useState(
    urlTab && NAMED_TABS.has(urlTab) ? urlTab : "pleadings",
  );
  const [highlightedHearingId, setHighlightedHearingId] = useState<number | null>(focusHearingId);
  const scrolledHearingRef = useRef<number | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(() => Boolean(caseId));
  const reportsRequestIdRef = useRef(0);
  const [openReport, setOpenReport] = useState<SavedReport | null>(null);
  const [confirmDeleteReport, setConfirmDeleteReport] = useState<SavedReport | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);
  const [printingReportId, setPrintingReportId] = useState<number | null>(null);

  // Keep tab + highlight in sync when the URL query changes (back/forward, in-app nav)
  useEffect(() => {
    setActiveTab(urlTab && NAMED_TABS.has(urlTab) ? urlTab : "pleadings");
    setHighlightedHearingId(focusHearingId);
    if (focusHearingId !== scrolledHearingRef.current) {
      scrolledHearingRef.current = null;
    }
  }, [urlTab, focusHearingId]);

  // Tab clicks update the URL (replace, so history isn't polluted); state follows via the effect above
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    navigate(`/cases/${caseId}${value === "pleadings" ? "" : `?tab=${value}`}`, { replace: true });
  };

  // ─── موضوع القضية — description state ─────────────────────────────────────
  const [descriptionText, setDescriptionText] = useState<string>("");
  const [descriptionSaving, setDescriptionSaving] = useState(false);

  // ─── Documents ─────────────────────────────────────────────────────────────
  const docFileRef = useRef<HTMLInputElement>(null);
  const { data: caseDocuments } = useListCaseDocuments(caseId, {
    query: { enabled: !!caseId, queryKey: getListCaseDocumentsQueryKey(caseId) },
  });
  const uploadDoc = useUploadCaseDocument();
  const updateDoc = useUpdateCaseDocument();
  const deleteDoc = useDeleteCaseDocument();
  const [courtNotesDrafts, setCourtNotesDrafts] = useState<Record<number, string>>({});
  const [updatingCourtDocId, setUpdatingCourtDocId] = useState<number | null>(null);
  const [savingCourtNotesDocId, setSavingCourtNotesDocId] = useState<number | null>(null);
  const [editingCourtDocId, setEditingCourtDocId] = useState<number | null>(null);
  const [confirmClearCourtDetails, setConfirmClearCourtDetails] = useState<CaseDocument | null>(null);

  const ALLOWED_DOC_TYPES = new Set([
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  ]);

  const handleDocUpload = (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const invalid = fileArr.filter(f => !ALLOWED_DOC_TYPES.has(f.type));
    if (invalid.length > 0) {
      toast({ variant: "destructive", title: "يُقبل ملفات PDF والصور فقط" });
      return;
    }
    let successCount = 0;
    fileArr.forEach((file) => {
      uploadDoc.mutate(
        { id: caseId, data: { file } },
        {
          onSuccess: () => {
            successCount++;
            queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(caseId) });
            if (successCount === fileArr.length) {
              toast({ title: fileArr.length > 1 ? `✅ تم رفع ${fileArr.length} ملفات بنجاح` : "✅ تم رفع المستند بنجاح" });
            }
          },
          onError: (err: any) => {
            toast({ variant: "destructive", title: err?.response?.data?.error ?? "فشل رفع المستند" });
          },
        },
      );
    });
  };

  const updateDocumentCache = (updatedDocument: CaseDocument) => {
    queryClient.setQueryData<CaseDocument[]>(
      getListCaseDocumentsQueryKey(caseId),
      (current) => current?.map((document) =>
        document.id === updatedDocument.id ? updatedDocument : document
      ),
    );
  };

  const handleToggleSubmitted = (document: CaseDocument, submittedToCourt: boolean) => {
    setUpdatingCourtDocId(document.id);
    updateDoc.mutate(
      { id: caseId, docId: document.id, data: { submittedToCourt } },
      {
        onSuccess: (updatedDocument) => {
          updateDocumentCache(updatedDocument);
          if (!updatedDocument.courtReplyType) {
            setCourtNotesDrafts((current) => {
              const next = { ...current };
              delete next[document.id];
              return next;
            });
             setEditingCourtDocId(null);
          }
          queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(caseId) });
        },
        onError: () => toast({ variant: "destructive", title: "فشل تحديث الحالة" }),
        onSettled: () => setUpdatingCourtDocId(null),
      },
    );
  };

  const handleCourtReplyTypeChange = (
    document: CaseDocument,
    courtReplyType: "PLAINTIFF" | "DEFENDANT",
    checked: boolean,
  ) => {
    if (!checked && document.courtReplyType !== courtReplyType) return;
    setUpdatingCourtDocId(document.id);
    const nextCourtReplyType = checked ? courtReplyType : null;
    updateDoc.mutate(
      {
        id: caseId,
        docId: document.id,
        data: {
          submittedToCourt: true,
          courtReplyType: nextCourtReplyType,
          ...(nextCourtReplyType === null ? { courtNotes: null } : {}),
        },
      },
      {
        onSuccess: (updatedDocument) => {
          updateDocumentCache(updatedDocument);
          if (!updatedDocument.courtReplyType) {
            setCourtNotesDrafts((current) => {
              const next = { ...current };
              delete next[document.id];
              return next;
            });
          }
          queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(caseId) });
        },
        onError: () => toast({ variant: "destructive", title: "فشل تحديث تصنيف المستند" }),
        onSettled: () => setUpdatingCourtDocId(null),
      },
    );
  };

  const handleSaveCourtNotes = (document: CaseDocument) => {
    const courtNotes = (courtNotesDrafts[document.id] ?? document.courtNotes ?? "").trim();
    setSavingCourtNotesDocId(document.id);
    updateDoc.mutate(
      {
        id: caseId,
        docId: document.id,
        data: { courtNotes: courtNotes || null },
      },
      {
        onSuccess: (updatedDocument) => {
          updateDocumentCache(updatedDocument);
          setCourtNotesDrafts((current) => ({
            ...current,
            [document.id]: updatedDocument.courtNotes ?? "",
          }));
           setEditingCourtDocId(null);
          queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(caseId) });
          toast({ title: "✅ تم حفظ ملاحظات المستند" });
        },
        onError: () => toast({ variant: "destructive", title: "فشل حفظ الملاحظات" }),
        onSettled: () => setSavingCourtNotesDocId(null),
      },
    );
  };

  const handleEditCourtDetails = (document: CaseDocument) => {
    setCourtNotesDrafts((current) => ({
      ...current,
      [document.id]: document.courtNotes ?? "",
    }));
    setEditingCourtDocId(document.id);
  };

  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<{ id: number; name: string } | null>(null);

  // ─── Financial summary state ───────────────────────────────────────────────
  type ContractRow = { id: number; fees: string | null; feeInstallments: any; caseNumber: string | null; clientId: number };
  type ContractPaymentRow = { id: number; contractId: number; description: string; amount: string; dueDate: string | null; isPaid: boolean; paidAt: string | null; notes: string | null };
  const [finContracts, setFinContracts] = useState<ContractRow[]>([]);
  const [finPayments, setFinPayments] = useState<ContractPaymentRow[]>([]);
  const [finLoading, setFinLoading] = useState(false);
  const [finAddOpen, setFinAddOpen] = useState(false);
  const [finNewDesc, setFinNewDesc] = useState("");
  const [finNewAmount, setFinNewAmount] = useState("");
  const [finNewDue, setFinNewDue] = useState("");
  const [finSaving, setFinSaving] = useState(false);
  const [finPayingId, setFinPayingId] = useState<number | null>(null);

  function getToken() { return localStorage.getItem("auth_token") ?? ""; }
  async function finFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(opts.headers ?? {}) },
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
    return res.json();
  }

  const loadFinancialData = async (caseNumber: string | null) => {
    if (!caseNumber) return;
    setFinLoading(true);
    try {
      // Fetch contracts to find matching ones
      const contracts = await finFetch<ContractRow[]>("/api/contracts");
      const matching = contracts.filter(c => c.caseNumber === caseNumber);
      setFinContracts(matching);
      if (matching.length > 0) {
        const allPayments: ContractPaymentRow[] = [];
        for (const c of matching) {
          const cp = await finFetch<ContractPaymentRow[]>(`/api/finances/contract-payments?contractId=${c.id}`);
          allPayments.push(...cp);
        }
        setFinPayments(allPayments);
      } else {
        setFinPayments([]);
      }
    } catch { /* silent */ }
    setFinLoading(false);
  };

  const handleFinAddPayment = async (contractId: number) => {
    if (!finNewDesc.trim() || !finNewAmount) { toast({ variant: "destructive", title: "الوصف والمبلغ مطلوبان" }); return; }
    setFinSaving(true);
    try {
      await finFetch("/api/finances/contract-payments", {
        method: "POST",
        body: JSON.stringify({ contractId, description: finNewDesc, amount: finNewAmount, dueDate: finNewDue || null }),
      });
      setFinAddOpen(false); setFinNewDesc(""); setFinNewAmount(""); setFinNewDue("");
      toast({ title: "تم إضافة الدفعة" });
      await loadFinancialData(caseInfo?.caseNumber ?? null);
    } catch (e: any) { toast({ variant: "destructive", title: e.message }); }
    setFinSaving(false);
  };

  const handleFinPay = async (paymentId: number) => {
    setFinPayingId(paymentId);
    try {
      await finFetch(`/api/finances/contract-payments/${paymentId}/pay`, { method: "PATCH" });
      toast({ title: "تم تسجيل الدفعة كمسدَّدة" });
      await loadFinancialData(caseInfo?.caseNumber ?? null);
    } catch (e: any) { toast({ variant: "destructive", title: e.message }); }
    setFinPayingId(null);
  };

  const handleFinDelete = async (paymentId: number) => {
    try {
      await finFetch(`/api/finances/contract-payments/${paymentId}`, { method: "DELETE" });
      setFinPayments(prev => prev.filter(p => p.id !== paymentId));
    } catch (e: any) { toast({ variant: "destructive", title: e.message }); }
  };

  const handleDocDelete = (docId: number, name: string) => {
    setConfirmDeleteDoc({ id: docId, name });
  };

  const confirmDocDeleteAction = () => {
    if (!confirmDeleteDoc) return;
    deleteDoc.mutate(
      { id: caseId, docId: confirmDeleteDoc.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(caseId) });
          toast({ title: `تم حذف "${confirmDeleteDoc.name}"` });
          setConfirmDeleteDoc(null);
        },
        onError: () => {
          toast({ variant: "destructive", title: "فشل حذف المستند" });
          setConfirmDeleteDoc(null);
        },
      },
    );
  };

  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<number | null>(null);

  const fetchDocBlob = async (docId: number): Promise<Blob> => {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/cases/${caseId}/documents/${docId}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  };

  const handleDocDownload = async (docId: number, fileName: string) => {
    setDownloadLoadingId(docId);
    try {
      const blob = await fetchDocBlob(docId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      toast({ variant: "destructive", title: "فشل تحميل الملف — تحقق من الاتصال" });
    } finally {
      setDownloadLoadingId(null);
    }
  };

  const handleDocPreview = async (docId: number, fileName: string) => {
    // Open the tab immediately (synchronous, within the click handler) so browsers
    // don't treat it as a popup and block it.
    const win = window.open("", "_blank");
    if (!win) {
      toast({ variant: "destructive", title: "السماح بالنوافذ المنبثقة مطلوب لمعاينة الملف" });
      return;
    }
    setPreviewLoadingId(docId);
    try {
      const blob = await fetchDocBlob(docId);
      const url = URL.createObjectURL(blob);
      win.location.href = url;
      // Revoke after a short delay to let the new tab load the blob
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      win.close();
      toast({ variant: "destructive", title: "فشل تحميل الملف للمعاينة" });
    } finally {
      setPreviewLoadingId(null);
    }
  };


  const { isManager } = useAuth();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPleadingOpen, setIsPleadingOpen] = useState(false);
  const [previewPleading, setPreviewPleading] = useState<{ id: number; type: string | null; content: string | null; status: string; addedByName?: string | null; addedByRole?: string | null; createdAt: string } | null>(null);
  const [isHearingOpen, setIsHearingOpen] = useState(false);
  const [isExecutionOpen, setIsExecutionOpen] = useState(false);
  const [confirmDeleteCase, setConfirmDeleteCase] = useState(false);

  const { data: caseInfo, isLoading: isCaseLoading } = useGetCase(caseId, {
    query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) }
  });

  const { data: pleadings } = useListPleadings({ caseId }, { query: { enabled: !!caseId, queryKey: getListPleadingsQueryKey({ caseId }) }});
  const { data: hearings } = useListHearings({ caseId }, { query: { enabled: !!caseId, queryKey: getListHearingsQueryKey({ caseId }) }});
  const { data: executions } = useListExecutions({ caseId }, { query: { enabled: !!caseId, queryKey: getListExecutionsQueryKey({ caseId }) }});

  const loadSavedReports = useCallback(async () => {
    const requestId = ++reportsRequestIdRef.current;
    if (!caseId) {
      setSavedReports([]);
      setReportsLoading(false);
      return;
    }

    setReportsLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`/api/cases/${caseId}/reports`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const reports = await response.json() as SavedReport[];
      if (requestId === reportsRequestIdRef.current) {
        setSavedReports(reports);
      }
    } catch {
      if (requestId === reportsRequestIdRef.current) {
        toast({ variant: "destructive", title: "فشل تحميل التقارير المحفوظة" });
      }
    } finally {
      if (requestId === reportsRequestIdRef.current) {
        setReportsLoading(false);
      }
    }
  }, [caseId, toast]);

  useEffect(() => {
    void loadSavedReports();
  }, [loadSavedReports]);

  const confirmReportDeleteAction = async () => {
    const reportToDelete = confirmDeleteReport;
    if (!reportToDelete) return;
    setDeletingReportId(reportToDelete.id);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`/api/cases/${caseId}/reports/${reportToDelete.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setSavedReports((current) => current.filter((report) => report.id !== reportToDelete.id));
      setConfirmDeleteReport(null);
      toast({ title: "تم حذف التقرير" });
    } catch {
      toast({ variant: "destructive", title: "فشل حذف التقرير" });
    } finally {
      setDeletingReportId(null);
    }
  };

  const printReport = async (report: SavedReport) => {
    setPrintingReportId(report.id);
    try {
      await printSavedReport(report, caseInfo?.caseNumber, caseInfo?.clientName);
    } catch {
      toast({ variant: "destructive", title: "فشل فتح معاينة التقرير" });
    } finally {
      setPrintingReportId(null);
    }
  };

  const updateCase = useUpdateCase();
  const deleteCase = useDeleteCase();
  const createPleading = useCreatePleading();
  const createHearing = useCreateHearing();
  const createExecution = useCreateExecution();

  const handleSoftDeleteCase = async () => {
    try {
      await deleteCase.mutateAsync({ id: caseId });
      queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
      queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
      toast({ title: `✅ تم حذف القضية "${caseInfo?.caseNumber || `#${caseId}`}"` });
      setConfirmDeleteCase(false);
    } catch {
      toast({ variant: "destructive", title: "فشل حذف القضية" });
    }
  };

  // Sync descriptionText whenever caseInfo loads/changes
  useEffect(() => {
    if (caseInfo) setDescriptionText(caseInfo.description ?? "");
  }, [caseInfo]);

  const handleSaveDescription = async () => {
    setDescriptionSaving(true);
    try {
      await updateCase.mutateAsync({ id: caseId, data: { description: descriptionText } });
      queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
      toast({ title: "✅ تم حفظ موضوع القضية" });
    } catch {
      toast({ variant: "destructive", title: "فشل حفظ موضوع القضية" });
    } finally {
      setDescriptionSaving(false);
    }
  };

  // Scroll to and highlight the hearing referenced in the URL (?hearing=ID)
  useEffect(() => {
    if (!focusHearingId || scrolledHearingRef.current === focusHearingId || !hearings || hearings.length === 0) return;
    const el = document.getElementById(`hearing-${focusHearingId}`);
    if (el) {
      scrolledHearingRef.current = focusHearingId;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = setTimeout(() => setHighlightedHearingId(null), 3500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [focusHearingId, hearings, activeTab]);

  const editForm = useForm<EditCaseFormValues>({
    resolver: zodResolver(editCaseSchema),
    defaultValues: { caseNumber: "", subject: "", clientRole: undefined, opponentName: "", jurisdiction: "", status: "UNDER_REVIEW" },
  });

  const pleadingForm = useForm<PleadingFormValues>({
    resolver: zodResolver(pleadingSchema),
    defaultValues: { type: "", content: "", status: "DRAFT" },
  });

  const hearingForm = useForm<HearingFormValues>({
    resolver: zodResolver(hearingSchema),
    defaultValues: { hijriDate: "", hearingTime: "", attendance: "", requiresLawsuitEditing: false, requiresReplyPrep: false, sessionLink: "" },
  });

  // Inline hearing report editing state: hearingId → draft text
  const [editingReportId, setEditingReportId] = useState<number | null>(null);
  const [reportDraft, setReportDraft] = useState<string>("");
  const updateHearing = useUpdateHearing();

  const executionForm = useForm<ExecutionFormValues>({
    resolver: zodResolver(executionSchema),
    defaultValues: { executionNumber: "", type: "", totalAmount: "", paidAmount: "" },
  });

  const openEdit = () => {
    if (!caseInfo) return;
    editForm.reset({
      caseNumber: caseInfo.caseNumber || "",
      subject: caseInfo.subject || "",
      clientRole: (caseInfo.clientRole as EditCaseFormValues["clientRole"]) || undefined,
      opponentName: caseInfo.opponentName || "",
      jurisdiction: caseInfo.jurisdiction || "",
      status: caseInfo.status as EditCaseFormValues["status"],
      outcome: (caseInfo.outcome as EditCaseFormValues["outcome"]) || "PENDING",
    });
    setIsEditOpen(true);
  };

  const onEditCase = async (data: EditCaseFormValues) => {
    try {
      await updateCase.mutateAsync({
        id: caseId,
        data: {
          subject: data.subject,
          status: data.status,
          outcome: data.status === "CLOSED" ? data.outcome : "PENDING",
          ...(data.caseNumber ? { caseNumber: data.caseNumber } : {}),
          ...(data.clientRole ? { clientRole: data.clientRole } : {}),
          ...(data.opponentName ? { opponentName: data.opponentName } : {}),
          ...(data.jurisdiction ? { jurisdiction: data.jurisdiction } : {}),
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
      queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
      toast({ title: "✅ تم تحديث بيانات القضية" });
      setIsEditOpen(false);
    } catch (err) {
      toast({ variant: "destructive", title: "فشل تحديث القضية", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  const onCreatePleading = async (data: PleadingFormValues) => {
    try {
      await createPleading.mutateAsync({
        data: { caseId, type: data.type, content: data.content, status: data.status },
      });
      queryClient.invalidateQueries({ queryKey: getListPleadingsQueryKey({ caseId }) });
      toast({ title: "✅ تم إضافة المذكرة بنجاح" });
      setIsPleadingOpen(false);
      pleadingForm.reset();
    } catch (err) {
      toast({ variant: "destructive", title: "فشل إضافة المذكرة", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  const onCreateHearing = async (data: HearingFormValues) => {
    try {
      // Convert Hijri date + time to UTC ISO string
      const match = data.hijriDate.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (!match) { toast({ variant: "destructive", title: "التاريخ الهجري غير صالح" }); return; }
      const gregorianDate = hijriToGregorian(Number(match[1]), Number(match[2]), Number(match[3]));
      const [hh, mm] = data.hearingTime.split(":").map(Number);
      gregorianDate.setHours(hh, mm, 0, 0);

      await createHearing.mutateAsync({
        data: {
          caseId,
          hijriDate: data.hijriDate,
          utcDate: gregorianDate.toISOString(),
          ...(data.attendance ? { attendance: data.attendance } : {}),
          ...(data.sessionLink ? { sessionLink: data.sessionLink } : {}),
          requiresLawsuitEditing: data.requiresLawsuitEditing,
          requiresReplyPrep: data.requiresReplyPrep,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListHearingsQueryKey({ caseId }) });
      toast({ title: "✅ تم جدولة الجلسة بنجاح" });
      setIsHearingOpen(false);
      hearingForm.reset();
    } catch (err) {
      toast({ variant: "destructive", title: "فشل إضافة الجلسة", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  const onSaveHearingReport = async (hearingId: number, report: string) => {
    try {
      await updateHearing.mutateAsync({ id: hearingId, data: { hearingReport: report } });
      queryClient.invalidateQueries({ queryKey: getListHearingsQueryKey({ caseId }) });
      setEditingReportId(null);
      toast({ title: "✅ تم حفظ محضر الجلسة" });
    } catch {
      toast({ variant: "destructive", title: "فشل حفظ المحضر" });
    }
  };

  const onCreateExecution = async (data: ExecutionFormValues) => {
    try {
      await createExecution.mutateAsync({
        data: {
          caseId,
          totalAmount: Number(data.totalAmount),
          paidAmount: data.paidAmount ? Number(data.paidAmount) : 0,
          ...(data.executionNumber ? { executionNumber: data.executionNumber } : {}),
          ...(data.type ? { type: data.type } : {}),
        },
      });
      queryClient.invalidateQueries({ queryKey: getListExecutionsQueryKey({ caseId }) });
      queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
      toast({ title: "✅ تم إنشاء طلب التنفيذ بنجاح" });
      setIsExecutionOpen(false);
      executionForm.reset();
    } catch (err) {
      toast({ variant: "destructive", title: "فشل إنشاء طلب التنفيذ", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  if (isCaseLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!caseInfo) return <AppLayout><div className="p-8 text-center text-muted-foreground">القضية غير موجودة</div></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Deleted banner */}
        {caseInfo.deletedAt && (
          <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            <OctagonX className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">هذه القضية محذوفة</span>
              {caseInfo.deletedByName && (
                <span className="text-destructive/70 mr-2">
                  — بواسطة {caseInfo.deletedByName}
                  {caseInfo.deletedByRole === "SYSTEM_MANAGER" ? " (مدير النظام)" : ""}
                </span>
              )}
            </div>
            <Badge className="bg-destructive/15 text-destructive border border-destructive/40 gap-1 shrink-0">
              <Trash2 className="w-3 h-3" />
              محذوفة
            </Badge>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Link href="/cases" className="p-2 hover:bg-muted rounded-full transition-colors mt-1">
              <ArrowRight className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className={`text-2xl font-bold tracking-tight ${caseInfo.deletedAt ? "line-through text-muted-foreground" : ""}`}>
                  {caseInfo.caseNumber || `ملف قضية #${caseInfo.id}`}
                </h2>
                <Badge variant={caseInfo.status === "CLOSED" ? "outline" : caseInfo.status === "EXECUTION" ? "destructive" : "default"} className="text-sm border-0">
                  {caseInfo.status === "CLOSED" ? "منتهية" : caseInfo.status === "EXECUTION" ? "تنفيذ" : caseInfo.status === "APPEAL" ? "الاستئناف" : "تحت النظر"}
                </Badge>
                {caseInfo.outcome === "WON" && (
                  <Badge className="text-sm border-0 bg-green-500/20 text-green-600 dark:text-green-400">ناجحة</Badge>
                )}
                {caseInfo.outcome === "LOST" && (
                  <Badge className="text-sm border-0 bg-red-500/20 text-red-600 dark:text-red-400">خاسرة</Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-1">{caseInfo.subject}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-primary border-primary/40 hover:bg-primary/10"
              onClick={() => navigate(`/cases/${caseId}/client-report`)}
            >
              <ClipboardList className="w-4 h-4" />
              إنشاء تقرير للعميل
            </Button>
            {!caseInfo.deletedAt && <Button variant="outline" size="sm" onClick={openEdit}>تعديل القضية</Button>}
            {isManager && !caseInfo.deletedAt && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmDeleteCase(true)}
              >
                <Trash2 className="w-4 h-4" />
                حذف القضية
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-4">
          <Card className="md:col-span-1 border-primary/10 shadow-sm bg-card/50">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm text-muted-foreground font-normal">العميل</CardTitle>
              <Link href={`/clients/${caseInfo.clientId}`} className="text-lg font-bold text-primary hover:underline block">
                {caseInfo.clientName}
              </Link>
            </CardHeader>
            <CardContent className="space-y-4 text-sm border-t border-border/50 pt-4">
              <div>
                <span className="text-muted-foreground block mb-1">حالة العميل</span>
                <span className="font-medium">{caseInfo.clientRole ? CLIENT_ROLE_LABELS[caseInfo.clientRole] : "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">
                  الطرف الثاني{opponentRoleLabel(caseInfo.clientRole) ? ` (${opponentRoleLabel(caseInfo.clientRole)})` : ""}
                </span>
                <span className="font-medium">{caseInfo.opponentName || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">جهة الاختصاص</span>
                <span className="font-medium">{caseInfo.jurisdiction || "-"}</span>
              </div>
            </CardContent>
          </Card>

          <div className="md:col-span-3 min-w-0">
            <Tabs value={activeTab} onValueChange={handleTabChange} dir="rtl" className="w-full min-w-0">
              <TabsList className="!flex w-full min-w-0 flex-wrap justify-start gap-1 h-auto p-1 bg-muted/50 border-b rounded-none rounded-t-lg">
                <TabsTrigger value="description" className="min-w-0 flex-[1_1_8rem] gap-2 whitespace-normal py-2 px-2 text-center leading-tight data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <FileEdit className="w-4 h-4" />
                  موضوع القضية
                </TabsTrigger>
                <TabsTrigger value="pleadings" className="min-w-0 flex-[1_1_8rem] gap-2 whitespace-normal py-2 px-2 text-center leading-tight data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <FileText className="w-4 h-4" />
                  المذكرات ({pleadings?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="hearings" className="min-w-0 flex-[1_1_8rem] gap-2 whitespace-normal py-2 px-2 text-center leading-tight data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <Scale className="w-4 h-4" />
                  الجلسات ({hearings?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="reports" className="min-w-0 flex-[1_1_8rem] gap-2 whitespace-normal py-2 px-2 text-center leading-tight data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <ClipboardList className="w-4 h-4" />
                  التقارير ({savedReports.length})
                </TabsTrigger>
                <TabsTrigger value="executions" className="min-w-0 flex-[1_1_8rem] gap-2 whitespace-normal py-2 px-2 text-center leading-tight data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <Gavel className="w-4 h-4" />
                  التنفيذ ({executions?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="documents" className="min-w-0 flex-[1_1_8rem] gap-2 whitespace-normal py-2 px-2 text-center leading-tight data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <FolderOpen className="w-4 h-4" />
                  مستندات القضية ({caseDocuments?.length || 0})
                </TabsTrigger>
                {isManager && (
                  <TabsTrigger
                    value="financial"
                    className="min-w-0 flex-[1_1_8rem] gap-2 whitespace-normal py-2 px-2 text-center leading-tight data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    onClick={() => loadFinancialData(caseInfo?.caseNumber ?? null)}
                  >
                    <DollarSign className="w-4 h-4" />
                    الملخص المالي
                  </TabsTrigger>
                )}
              </TabsList>
              
              <TabsContent value="description" className="p-0 border border-t-0 rounded-b-lg bg-card shadow-sm">
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-base">موضوع القضية</h3>
                    <Button
                      size="sm"
                      onClick={handleSaveDescription}
                      disabled={descriptionSaving}
                      className="gap-2"
                    >
                      {descriptionSaving
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Save className="w-4 h-4" />}
                      حفظ
                    </Button>
                  </div>
                  <Textarea
                    dir="rtl"
                    value={descriptionText}
                    onChange={(e) => setDescriptionText(e.target.value)}
                    placeholder="اكتب هنا تفاصيل موضوع القضية، وقائعها، والمطالبات..."
                    className="min-h-[320px] resize-y text-sm leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    {descriptionText.length} حرف
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="pleadings" className="p-0 border border-t-0 rounded-b-lg bg-card shadow-sm">
                <div className="p-4 flex justify-between items-center border-b">
                  <h3 className="font-medium">المذكرات القانونية واللوائح</h3>
                  <Button size="sm" onClick={() => setIsPleadingOpen(true)}><FileEdit className="w-4 h-4 ml-2" /> إضافة مذكرة</Button>
                </div>
                <div className="p-0">
                  {pleadings && pleadings.length > 0 ? (
                    <div className="divide-y">
                      {pleadings.map(p => {
                        const roleLabel = p.addedByRole === "SYSTEM_MANAGER" ? "مدير النظام" : p.addedByRole === "TECHNICIAN" ? "موظف" : null;
                        return (
                          <div key={p.id} className="group p-4 hover:bg-muted/30 transition-colors flex justify-between items-start gap-3">
                            <div className="flex-1 min-w-0">
                              {/* Title + status */}
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-semibold">{p.type || "مذكرة"}</span>
                                {p.status === "DRAFT" ? (
                                  <Badge variant="secondary" className="text-xs">مسودة</Badge>
                                ) : (
                                  <Badge className="bg-emerald-500 hover:bg-emerald-600 text-xs">مقدمة</Badge>
                                )}
                              </div>
                              {/* Content preview */}
                              <p className="text-sm text-muted-foreground line-clamp-1 mb-2">{p.content || "لا يوجد محتوى"}</p>
                              {/* Added by */}
                              {p.addedByName && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <User className="w-3 h-3" />
                                  <span>{p.addedByName}</span>
                                  {roleLabel && (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0">{roleLabel}</Badge>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Preview button */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="shrink-0 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => setPreviewPleading(p)}
                            >
                              <Eye className="w-4 h-4" />
                              معاينة
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center">
                      <FileText className="w-8 h-8 mb-2 opacity-20" />
                      لا توجد مذكرات مسجلة لهذه القضية
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="hearings" className="p-0 border border-t-0 rounded-b-lg bg-card shadow-sm">
                <div className="p-4 flex justify-between items-center border-b">
                  <h3 className="font-medium">سجل الجلسات</h3>
                  <Button size="sm" onClick={() => setIsHearingOpen(true)}><Scale className="w-4 h-4 ml-2" /> إضافة جلسة</Button>
                </div>
                <div className="p-0">
                  {hearings && hearings.length > 0 ? (
                    <div className="divide-y">
                      {hearings.map(h => {
                        const effStatus = (h as any).effectiveStatus ?? (new Date(h.utcDate) < new Date() ? "ENDED" : "UPCOMING");
                        return (
                        <div
                          key={h.id}
                          id={`hearing-${h.id}`}
                          className={`p-4 transition-colors duration-700 flex flex-col gap-3 ${
                            highlightedHearingId === h.id
                              ? "bg-primary/15 ring-2 ring-primary/40 ring-inset"
                              : "hover:bg-muted/30"
                          }`}
                        >
                          {/* Header row */}
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-semibold text-primary">{h.hijriDate}</span>
                                {/* Hearing status — clickable select for both roles */}
                                <Select
                                  value={effStatus}
                                  onValueChange={async (val) => {
                                    await updateHearing.mutateAsync({
                                      id: h.id,
                                      data: { status: val as HearingUpdateStatus },
                                    });
                                    queryClient.invalidateQueries({ queryKey: getListHearingsQueryKey({ caseId }) });
                                  }}
                                >
                                  <SelectTrigger className="h-6 w-auto text-xs px-2 border rounded-full focus:ring-0 gap-1 shadow-none">
                                    <SelectValue>
                                      {effStatus === "ENDED" && <span className="text-muted-foreground">منتهية</span>}
                                      {effStatus === "CANCELLED" && <span className="text-destructive">ملغاة</span>}
                                      {effStatus === "UPCOMING" && <span className="text-emerald-600 dark:text-emerald-400">قادمة</span>}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent align="start">
                                    <SelectItem value="UPCOMING">قادمة</SelectItem>
                                    <SelectItem value="ENDED">منتهية</SelectItem>
                                    <SelectItem value="CANCELLED">ملغاة</SelectItem>
                                  </SelectContent>
                                </Select>
                                {h.requiresLawsuitEditing && (
                                  <Badge variant="destructive" className="text-xs">تتطلب تحرير دعوى</Badge>
                                )}
                                {h.requiresReplyPrep && (
                                  <Badge variant="destructive" className="text-xs">تتطلب تجهيز رد</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">الحضور: {h.attendance || "لم يسجل"}</p>
                              {h.sessionLink && (
                                <a
                                  href={h.sessionLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                                >
                                  <Link2 className="w-3 h-3" />
                                  رابط الجلسة القادمة
                                </a>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1 text-xs shrink-0"
                              onClick={() => {
                                setEditingReportId(h.id);
                                setReportDraft(h.hearingReport || "");
                              }}
                            >
                              <Pencil className="w-3 h-3" />
                              {h.hearingReport ? "تعديل المحضر" : "تدوين ما تم"}
                            </Button>
                          </div>

                          {/* Hearing report display / edit */}
                          {editingReportId === h.id ? (
                            <div className="flex flex-col gap-2">
                              <Textarea
                                className="text-sm min-h-[100px]"
                                placeholder="دوّن ما تم في الجلسة..."
                                value={reportDraft}
                                onChange={(e) => setReportDraft(e.target.value)}
                                autoFocus
                              />
                              <div className="flex gap-2 justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingReportId(null)}
                                >
                                  إلغاء
                                </Button>
                                <Button
                                  size="sm"
                                  className="gap-1"
                                  disabled={updateHearing.isPending}
                                  onClick={() => onSaveHearingReport(h.id, reportDraft)}
                                >
                                  {updateHearing.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                  حفظ
                                </Button>
                              </div>
                            </div>
                          ) : h.hearingReport ? (
                            <div className="bg-muted/40 border rounded-md p-3">
                              <p className="text-xs font-medium text-muted-foreground mb-1">محضر الجلسة</p>
                              <p className="text-sm whitespace-pre-wrap">{h.hearingReport}</p>
                            </div>
                          ) : null}
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center">
                      <Scale className="w-8 h-8 mb-2 opacity-20" />
                      لا توجد جلسات مسجلة لهذه القضية
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── Saved client reports tab ───────────────────────────── */}
              <TabsContent value="reports" className="p-0 border border-t-0 rounded-b-lg bg-card shadow-sm">
                <div className="p-4 flex justify-between items-center border-b gap-3">
                  <div>
                    <h3 className="font-medium">التقارير المحفوظة</h3>
                    <p className="text-xs text-muted-foreground mt-1">افتح التقرير أو اطبعه أو احذفه من القائمة</p>
                  </div>
                  <Button
                    size="sm"
                    className="gap-2 shrink-0"
                    onClick={() => navigate(`/cases/${caseId}/client-report`)}
                  >
                    <ClipboardList className="w-4 h-4" />
                    إنشاء تقرير
                  </Button>
                </div>
                {reportsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : savedReports.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground flex flex-col items-center justify-center gap-3">
                    <ClipboardList className="w-10 h-10 opacity-20" />
                    <p className="text-sm">لا توجد تقارير محفوظة لهذه القضية</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => navigate(`/cases/${caseId}/client-report`)}
                    >
                      <ClipboardList className="w-4 h-4" />
                      إنشاء أول تقرير
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y">
                    {savedReports.map((report) => (
                      <div key={report.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-muted/30 transition-colors">
                        <ClipboardList className="w-5 h-5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{report.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(report.createdAt).toLocaleDateString("ar-SA", {
                              year: "numeric", month: "long", day: "numeric",
                            })}
                            {" · "}
                            {report.reportData.length} قسم
                          </p>
                          {report.lastSentAt && (
                            <p className="text-xs text-emerald-700 mt-1 break-words">
                              أُرسل في {new Date(report.lastSentAt).toLocaleDateString("ar-SA", {
                                year: "numeric", month: "long", day: "numeric",
                              })}
                              {report.lastSentTo ? ` إلى ${report.lastSentTo}` : ""}
                              {report.lastSentBy ? ` بواسطة ${report.lastSentBy}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1"
                            onClick={() => setOpenReport(report)}
                          >
                            <FileText className="w-3 h-3" />
                            فتح
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1"
                            disabled={printingReportId === report.id}
                            onClick={() => void printReport(report)}
                          >
                            {printingReportId === report.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Printer className="w-3 h-3" />}
                            طباعة
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            aria-label={`حذف التقرير ${report.title}`}
                            title="حذف التقرير"
                            onClick={() => setConfirmDeleteReport(report)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── Documents Tab ─────────────────────────────────────── */}
              <TabsContent value="documents" className="p-0 border border-t-0 rounded-b-lg bg-card shadow-sm">
                <div className="p-4 flex justify-between items-center border-b">
                  <h3 className="font-medium">مستندات القضية</h3>
                  <Button
                    size="sm"
                    onClick={() => docFileRef.current?.click()}
                    disabled={uploadDoc.isPending}
                    className="gap-2"
                  >
                    {uploadDoc.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    رفع ملفات
                  </Button>
                  <input
                    ref={docFileRef}
                    type="file"
                    multiple
                    accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) handleDocUpload(files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {(() => {
                  const activeDocs = (caseDocuments ?? []).filter(d => !d.deletedAt);
                  const deletedDocs = (caseDocuments ?? []).filter(d => !!d.deletedAt);

                  const roleLabel = (role: string | null | undefined) =>
                    role === "SYSTEM_MANAGER" ? "مدير النظام" : role === "TECHNICIAN" ? "الثانوي" : (role ?? "");

                  return (
                    <>
                      {/* ── Active documents ───────────────────────────── */}
                      {activeDocs.length === 0 ? (
                        <div className="p-10 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                          <FolderOpen className="w-10 h-10 opacity-20" />
                          <p className="text-sm">لا توجد مستندات مرفوعة لهذه القضية</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => docFileRef.current?.click()}
                          >
                            <Upload className="w-4 h-4" />
                            ارفع أول مستند
                          </Button>
                        </div>
                      ) : (
                        <div className="divide-y">
                          {activeDocs.map((doc, idx) => (
                            <div
                              key={doc.id}
                              className="group px-4 py-4 hover:bg-muted/30 transition-colors"
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                                 <div className="flex min-w-0 flex-1 flex-col gap-2">
                                   {/* Sequential number + file information */}
                                   <div className="flex min-w-0 items-center gap-4">
                                     <div className="shrink-0 flex flex-col items-center gap-0.5">
                                       <span className="text-[10px] font-bold text-primary/70 leading-none">{idx + 1}</span>
                                       <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                                         <FileBadge className="w-4 h-4 text-primary" />
                                       </div>
                                    </div>
                                     <div className="min-w-0">
                                       <p className="text-sm font-medium truncate leading-snug">{doc.fileName}</p>
                                       <p className="text-xs text-muted-foreground mt-0.5">
                                         {new Date(doc.uploadedAt).toLocaleDateString("ar-SA", {
                                           year: "numeric", month: "short", day: "numeric",
                                         })}
                                       </p>
                                     </div>
                                  </div>

                                   {/* Court submission details */}
                                   <div className="mr-0 min-w-0">
                                     <div className="flex items-center gap-2">
                                       <Checkbox
                                         id={`doc-submitted-${doc.id}`}
                                         checked={doc.submittedToCourt}
                                         onCheckedChange={(checked) => handleToggleSubmitted(doc, checked === true)}
                                         disabled={updatingCourtDocId === doc.id}
                                         className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                       />
                                       <label
                                         htmlFor={`doc-submitted-${doc.id}`}
                                         className={`text-xs select-none cursor-pointer transition-colors ${
                                           doc.submittedToCourt ? "text-primary font-semibold" : "text-muted-foreground"
                                         }`}
                                       >
                                         تم رفعه للمحكمة
                                       </label>
                                       {updatingCourtDocId === doc.id && (
                                         <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                       )}
                                     </div>

                                     {doc.submittedToCourt && (
                                       editingCourtDocId === doc.id ? (
                                         <div className="mr-6 mt-2 max-w-2xl rounded-lg border border-primary/15 bg-background/70 p-3">
                                           <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                                             <span className="w-full text-xs font-medium text-foreground">نوع الرد</span>
                                             <div className="flex items-center gap-2">
                                               <Checkbox
                                                 id={`doc-plaintiff-reply-${doc.id}`}
                                                 checked={doc.courtReplyType === "PLAINTIFF"}
                                                 onCheckedChange={(checked) =>
                                                   handleCourtReplyTypeChange(doc, "PLAINTIFF", checked === true)
                                                 }
                                                 disabled={updatingCourtDocId === doc.id}
                                               />
                                               <label
                                                 htmlFor={`doc-plaintiff-reply-${doc.id}`}
                                                 className="cursor-pointer select-none text-xs"
                                               >
                                                 رد المدعي
                                               </label>
                                             </div>
                                             <div className="flex items-center gap-2">
                                               <Checkbox
                                                 id={`doc-defendant-reply-${doc.id}`}
                                                 checked={doc.courtReplyType === "DEFENDANT"}
                                                 onCheckedChange={(checked) =>
                                                   handleCourtReplyTypeChange(doc, "DEFENDANT", checked === true)
                                                 }
                                                 disabled={updatingCourtDocId === doc.id}
                                               />
                                               <label
                                                 htmlFor={`doc-defendant-reply-${doc.id}`}
                                                 className="cursor-pointer select-none text-xs"
                                               >
                                                 رد المدعى عليه
                                               </label>
                                             </div>
                                           </div>

                                           {doc.courtReplyType && (
                                             <div className="mt-3 space-y-2">
                                               <Label htmlFor={`doc-court-notes-${doc.id}`} className="text-xs">
                                                 الملاحظة
                                               </Label>
                                               <Textarea
                                                 id={`doc-court-notes-${doc.id}`}
                                                 value={courtNotesDrafts[doc.id] ?? doc.courtNotes ?? ""}
                                                 onChange={(event) => setCourtNotesDrafts((current) => ({
                                                   ...current,
                                                   [doc.id]: event.target.value,
                                                 }))}
                                                 placeholder="دوّن ملاحظة هذا المستند..."
                                                 className="min-h-[64px] resize-y bg-background"
                                               />
                                               <div className="flex flex-wrap justify-end gap-2">
                                                 <Button
                                                   type="button"
                                                   size="sm"
                                                   variant="ghost"
                                                   className="h-8"
                                                   onClick={() => setEditingCourtDocId(null)}
                                                 >
                                                   إلغاء
                                                 </Button>
                                                 <Button
                                                   type="button"
                                                   size="sm"
                                                   className="h-8 gap-2"
                                                   onClick={() => handleSaveCourtNotes(doc)}
                                                   disabled={savingCourtNotesDocId === doc.id}
                                                 >
                                                   {savingCourtNotesDocId === doc.id
                                                     ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                     : <Save className="h-3.5 w-3.5" />}
                                                   حفظ
                                                 </Button>
                                               </div>
                                             </div>
                                           )}
                                         </div>
                                       ) : (
                                         <div className="mr-6 mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                           <span className="max-w-full break-words">
                                             الملاحظة: {doc.courtNotes?.trim() || "لا توجد ملاحظة"}
                                           </span>
                                           {doc.courtReplyType && (
                                             <span className="whitespace-nowrap">
                                               نوع الرد: {doc.courtReplyType === "PLAINTIFF" ? "رد المدعي" : "رد المدعى عليه"}
                                             </span>
                                           )}
                                           <span className="whitespace-nowrap">
                                             تاريخ الرفع: {new Date(doc.uploadedAt).toLocaleDateString("ar-SA", {
                                               year: "numeric", month: "short", day: "numeric",
                                             })}
                                           </span>
                                           <span className="flex items-center gap-1">
                                             <Button
                                               type="button"
                                               variant="ghost"
                                               size="icon"
                                               className="h-7 w-7 text-muted-foreground hover:text-primary"
                                               onClick={() => handleEditCourtDetails(doc)}
                                               aria-label="تعديل بيانات المحكمة"
                                               title="تعديل بيانات المحكمة"
                                             >
                                               <Pencil className="h-3.5 w-3.5" />
                                             </Button>
                                             <Button
                                               type="button"
                                               variant="ghost"
                                               size="icon"
                                               className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                               onClick={() => setConfirmClearCourtDetails(doc)}
                                               aria-label="حذف بيانات المحكمة"
                                               title="حذف بيانات المحكمة"
                                             >
                                               <Trash2 className="h-3.5 w-3.5" />
                                             </Button>
                                           </span>
                                         </div>
                                       )
                                     )}
                                   </div>
                                 </div>

                                 {/* File actions */}
                                 <div className="flex items-center gap-1 self-end shrink-0 opacity-100 transition-opacity lg:self-start lg:opacity-0 lg:group-hover:opacity-100">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    onClick={() => handleDocPreview(doc.id, doc.fileName)}
                                    disabled={previewLoadingId === doc.id}
                                    title="معاينة"
                                  >
                                    {previewLoadingId === doc.id
                                      ? <Loader2 className="w-4 h-4 animate-spin" />
                                      : <Eye className="w-4 h-4" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    onClick={() => handleDocDownload(doc.id, doc.fileName)}
                                    disabled={downloadLoadingId === doc.id}
                                    title="تحميل"
                                  >
                                    {downloadLoadingId === doc.id
                                      ? <Loader2 className="w-4 h-4 animate-spin" />
                                      : <Download className="w-4 h-4" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDocDelete(doc.id, doc.fileName)}
                                    disabled={deleteDoc.isPending}
                                    title="حذف"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Deleted documents section ──────────────────── */}
                      {deletedDocs.length > 0 && (
                        <div className="border-t border-dashed border-destructive/20">
                          {/* Section header */}
                          <div className="flex items-center gap-2 px-4 py-2.5 bg-destructive/5">
                            <ShieldAlert className="w-3.5 h-3.5 text-destructive/60 shrink-0" />
                            <span className="text-xs font-medium text-destructive/70">
                              المستندات المحذوفة ({deletedDocs.length})
                            </span>
                          </div>

                          <div className="divide-y divide-destructive/10">
                            {deletedDocs.map((doc, idx) => (
                              <div
                                key={doc.id}
                                className="flex items-center gap-4 px-4 py-3 bg-destructive/[0.03] opacity-70"
                              >
                                {/* Number + icon (dimmed) */}
                                <div className="shrink-0 flex flex-col items-center gap-0.5">
                                  <span className="text-[10px] font-bold text-muted-foreground/50 leading-none">{idx + 1}</span>
                                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 border border-border/50">
                                    <FileBadge className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                </div>

                                {/* Name (strikethrough) + date + deletion attribution */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate leading-snug line-through decoration-destructive/50 text-muted-foreground">
                                    {doc.fileName}
                                  </p>
                                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                                    رُفع في{" "}
                                    {new Date(doc.uploadedAt).toLocaleDateString("ar-SA", {
                                      year: "numeric", month: "short", day: "numeric",
                                    })}
                                  </p>
                                  {doc.deletedByName && (
                                    <p className="text-[11px] text-destructive/70 mt-1 font-medium flex items-center gap-1">
                                      <ShieldAlert className="w-3 h-3 shrink-0" />
                                      تم الحذف من قبل {roleLabel(doc.deletedByRole)} {doc.deletedByName}
                                    </p>
                                  )}
                                  {doc.deletedAt && (
                                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                                      في{" "}
                                      {new Date(doc.deletedAt).toLocaleDateString("ar-SA", {
                                        year: "numeric", month: "short", day: "numeric",
                                        hour: "2-digit", minute: "2-digit",
                                      })}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </TabsContent>

              <TabsContent value="executions" className="p-0 border border-t-0 rounded-b-lg bg-card shadow-sm">
                <div className="p-4 flex justify-between items-center border-b">
                  <h3 className="font-medium">طلبات التنفيذ</h3>
                  <Button size="sm" onClick={() => setIsExecutionOpen(true)}><Gavel className="w-4 h-4 ml-2" /> طلب تنفيذ</Button>
                </div>
                <div className="p-0">
                  {executions && executions.length > 0 ? (
                    <div className="divide-y">
                      {executions.map(e => (
                        <div key={e.id} className="p-4 hover:bg-muted/30 transition-colors">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-primary">{e.executionNumber || `طلب #${e.id}`}</span>
                                <Badge variant="outline" className="text-xs">{e.type || "تنفيذ"}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">حالة السداد: {e.status}</p>
                            </div>
                            <div className="text-left font-mono">
                              <span className="block text-sm text-muted-foreground">المبلغ المتبقي</span>
                              <span className="font-bold text-destructive">{e.remainingAmount.toLocaleString()} ﷼</span>
                            </div>
                          </div>
                          <div className="w-full bg-secondary rounded-full h-2 mt-2">
                            <div 
                              className="bg-primary h-2 rounded-full" 
                              style={{ width: `${e.totalAmount > 0 ? (e.paidAmount / e.totalAmount) * 100 : 0}%` }}
                            ></div>
                          </div>
                          <div className="flex justify-between text-xs mt-1 text-muted-foreground">
                            <span>مسدد: {e.paidAmount.toLocaleString()} ﷼</span>
                            <span>الإجمالي: {e.totalAmount.toLocaleString()} ﷼</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center">
                      <Gavel className="w-8 h-8 mb-2 opacity-20" />
                      لا توجد طلبات تنفيذ لهذه القضية
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ─── الملخص المالي (manager only) ─────────────────────────── */}
              {isManager && (
                <TabsContent value="financial" className="p-0 border border-t-0 rounded-b-lg bg-card shadow-sm">
                  {finLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="p-4 space-y-4" dir="rtl">
                      {/* Summary cards */}
                      {finContracts.length > 0 && (() => {
                        const totalFees = finContracts.reduce((s, c) => s + parseFloat(c.fees ?? "0"), 0);
                        const paidAmt = finPayments.filter(p => p.isPaid).reduce((s, p) => s + parseFloat(p.amount), 0);
                        const remaining = totalFees - paidAmt;
                        return (
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: "إجمالي الأتعاب", value: totalFees, cls: "text-foreground" },
                              { label: "المسدَّد", value: paidAmt, cls: "text-emerald-600" },
                              { label: "المتبقي", value: remaining, cls: remaining > 0 ? "text-amber-600" : "text-emerald-600" },
                            ].map(c => (
                              <div key={c.label} className="rounded-lg border p-3 text-center bg-muted/20">
                                <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
                                <p className={`font-bold text-sm ${c.cls}`}>
                                  {new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2 }).format(c.value)} ر.س
                                </p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* Contract info */}
                      {finContracts.length === 0 && (
                        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                          <DollarSign className="w-10 h-10 opacity-20" />
                          <p className="text-sm">لا يوجد عقد مرتبط بهذه القضية</p>
                          <p className="text-xs">تأكد من ربط العقد برقم القضية {caseInfo?.caseNumber ?? ""}</p>
                        </div>
                      )}

                      {/* Payment records */}
                      {finContracts.length > 0 && (
                        <>
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold">سجل الدفعات والأتعاب المستحقة</h4>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => setFinAddOpen(v => !v)}
                            >
                              <Plus className="w-3.5 h-3.5" />
                              إضافة دفعة
                            </Button>
                          </div>

                          {/* Add payment form */}
                          {finAddOpen && finContracts[0] && (
                            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                              <p className="text-xs font-medium text-muted-foreground">دفعة جديدة</p>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                  <Label className="text-xs">الوصف <span className="text-destructive">*</span></Label>
                                  <Input
                                    className="h-8 text-sm mt-1"
                                    placeholder="مثال: دفعة أولى - أتعاب التمثيل"
                                    value={finNewDesc}
                                    onChange={e => setFinNewDesc(e.target.value)}
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">المبلغ (ر.س) <span className="text-destructive">*</span></Label>
                                  <Input
                                    className="h-8 text-sm mt-1"
                                    type="number" min="0" step="0.01"
                                    value={finNewAmount}
                                    onChange={e => setFinNewAmount(e.target.value)}
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">تاريخ الاستحقاق</Label>
                                  <Input
                                    className="h-8 text-sm mt-1"
                                    type="date"
                                    value={finNewDue}
                                    onChange={e => setFinNewDue(e.target.value)}
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="outline" onClick={() => setFinAddOpen(false)}>إلغاء</Button>
                                <Button size="sm" disabled={finSaving} onClick={() => handleFinAddPayment(finContracts[0].id)}>
                                  {finSaving && <Loader2 className="w-3 h-3 ml-1 animate-spin" />}
                                  حفظ
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Payments list */}
                          {finPayments.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">لا توجد دفعات مسجلة بعد</p>
                          ) : (
                            <div className="divide-y border rounded-lg overflow-hidden">
                              {finPayments.map((p, idx) => (
                                <div key={p.id} className="flex items-center justify-between px-4 py-2.5 bg-background hover:bg-muted/20 transition-colors">
                                  <div className="flex items-center gap-3">
                                    {p.isPaid ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                    ) : (
                                      <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                                    )}
                                    <div>
                                      <p className="text-sm font-medium">{p.description}</p>
                                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span className="font-bold text-foreground">
                                          {new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2 }).format(parseFloat(p.amount))} ر.س
                                        </span>
                                        {p.dueDate && <span>الاستحقاق: {p.dueDate}</span>}
                                        {p.isPaid && p.paidAt && (
                                          <span className="text-emerald-600">سُدِّدت {new Date(p.paidAt).toLocaleDateString("ar-SA")}</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {!p.isPaid && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs gap-1"
                                        disabled={finPayingId === p.id}
                                        onClick={() => handleFinPay(p.id)}
                                      >
                                        {finPayingId === p.id
                                          ? <Loader2 className="w-3 h-3 animate-spin" />
                                          : <CheckCircle2 className="w-3 h-3" />}
                                        تسديد
                                      </Button>
                                    )}
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                      onClick={() => handleFinDelete(p.id)}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>
        </div>
      </div>

      <ClientReportModal
        open={!!openReport}
        onClose={() => setOpenReport(null)}
        caseId={caseId}
        caseNumber={caseInfo.caseNumber}
        caseSubject={caseInfo.subject}
        clientName={caseInfo.clientName}
        initialReport={openReport}
        onReportsChanged={() => { void loadSavedReports(); }}
      />

      {/* ── Saved report deletion confirmation ─────────────────────── */}
      <AlertDialog open={!!confirmDeleteReport} onOpenChange={(open) => !open && setConfirmDeleteReport(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              تأكيد حذف التقرير
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              هل أنت متأكد من حذف التقرير{" "}
              <span className="font-semibold text-foreground">"{confirmDeleteReport?.title}"</span>؟
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">
                لا يمكن التراجع عن حذف التقرير المحفوظ.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={deletingReportId !== null}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              disabled={deletingReportId !== null}
              onClick={(event) => {
                event.preventDefault();
                void confirmReportDeleteAction();
              }}
            >
              {deletingReportId !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit case dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل القضية</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEditCase)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-caseNumber">رقم القضية</Label>
              <Input id="edit-caseNumber" placeholder="مثال: 4520/1447" {...editForm.register("caseNumber")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-subject">الموضوع *</Label>
              <Textarea id="edit-subject" rows={2} {...editForm.register("subject")} />
              {editForm.formState.errors.subject && (
                <p className="text-xs text-destructive">{editForm.formState.errors.subject.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>حالة العميل</Label>
              <Controller
                control={editForm.control}
                name="clientRole"
                render={({ field }) => (
                  <Select onValueChange={(v) => field.onChange(v as EditCaseFormValues["clientRole"])} value={field.value ?? ""}>
                    <SelectTrigger className="text-right" dir="rtl">
                      <SelectValue placeholder="اختر صفة العميل في القضية" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="PLAINTIFF">مدعي</SelectItem>
                      <SelectItem value="DEFENDANT">مدعى عليه</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-opponent">
                اسم الطرف الثاني
                {opponentRoleLabel(editForm.watch("clientRole")) && (
                  <span className="text-muted-foreground text-xs mr-2">(صفته: {opponentRoleLabel(editForm.watch("clientRole"))})</span>
                )}
              </Label>
              <Input id="edit-opponent" {...editForm.register("opponentName")} />
            </div>
            <div className="space-y-2">
              <Label>جهة الاختصاص</Label>
              <Controller
                control={editForm.control}
                name="jurisdiction"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <SelectTrigger className="text-right" dir="rtl">
                      <SelectValue placeholder="اختر جهة الاختصاص" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <JurisdictionSelectItems />
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>الحالة *</Label>
              <Select
                value={editForm.watch("status")}
                onValueChange={(v) => {
                  editForm.setValue("status", v as EditCaseFormValues["status"]);
                  if (v !== "CLOSED") {
                    editForm.setValue("outcome", "PENDING");
                    editForm.clearErrors("outcome");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNDER_REVIEW">تحت النظر</SelectItem>
                  <SelectItem value="APPEAL">الاستئناف</SelectItem>
                  <SelectItem value="EXECUTION">تنفيذ</SelectItem>
                  <SelectItem value="CLOSED">منتهية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editForm.watch("status") === "CLOSED" && (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <Label>نتيجة القضية *</Label>
                <p className="text-xs text-muted-foreground">هل كسب المكتب هذه القضية أم خسرها؟</p>
                <Select
                  value={editForm.watch("outcome") === "WON" || editForm.watch("outcome") === "LOST" ? editForm.watch("outcome") : ""}
                  onValueChange={(v) => {
                    editForm.setValue("outcome", v as EditCaseFormValues["outcome"]);
                    editForm.clearErrors("outcome");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر نتيجة القضية" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WON">كسبها المكتب ✅</SelectItem>
                    <SelectItem value="LOST">خسرها المكتب ❌</SelectItem>
                  </SelectContent>
                </Select>
                {editForm.formState.errors.outcome && (
                  <p className="text-sm text-destructive">{editForm.formState.errors.outcome.message}</p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={updateCase.isPending} className="w-full gap-2">
                {updateCase.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                حفظ التعديلات
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add pleading dialog */}
      <Dialog open={isPleadingOpen} onOpenChange={setIsPleadingOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة مذكرة جديدة</DialogTitle>
          </DialogHeader>
          <form onSubmit={pleadingForm.handleSubmit(onCreatePleading)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pleading-type">نوع المذكرة *</Label>
              <Input id="pleading-type" placeholder="مثال: مذكرة رد / لائحة اعتراضية" {...pleadingForm.register("type")} />
              {pleadingForm.formState.errors.type && (
                <p className="text-xs text-destructive">{pleadingForm.formState.errors.type.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="pleading-content">المحتوى *</Label>
              <Textarea id="pleading-content" rows={5} placeholder="نص المذكرة..." {...pleadingForm.register("content")} />
              {pleadingForm.formState.errors.content && (
                <p className="text-xs text-destructive">{pleadingForm.formState.errors.content.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>الحالة *</Label>
              <Select
                value={pleadingForm.watch("status")}
                onValueChange={(v) => pleadingForm.setValue("status", v as PleadingFormValues["status"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">مسودة</SelectItem>
                  <SelectItem value="SUBMITTED">مقدمة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createPleading.isPending} className="w-full gap-2">
                {createPleading.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                إضافة المذكرة
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add hearing dialog */}
      <Dialog open={isHearingOpen} onOpenChange={setIsHearingOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>جدولة جلسة جديدة</DialogTitle>
          </DialogHeader>
          <form onSubmit={hearingForm.handleSubmit(onCreateHearing)} className="space-y-4">
            {/* التاريخ الهجري — date picker */}
            <div className="space-y-2">
              <Label>تاريخ الجلسة (هجري) *</Label>
              <Controller
                control={hearingForm.control}
                name="hijriDate"
                render={({ field }) => (
                  <HijriDatePicker
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="اختر التاريخ الهجري"
                    hasError={!!hearingForm.formState.errors.hijriDate}
                  />
                )}
              />
              {hearingForm.formState.errors.hijriDate && (
                <p className="text-xs text-destructive">{hearingForm.formState.errors.hijriDate.message}</p>
              )}
            </div>
            {/* وقت الجلسة */}
            <div className="space-y-2">
              <Label htmlFor="hearing-time">وقت الجلسة *</Label>
              <Input id="hearing-time" type="time" dir="ltr" {...hearingForm.register("hearingTime")} />
              {hearingForm.formState.errors.hearingTime && (
                <p className="text-xs text-destructive">{hearingForm.formState.errors.hearingTime.message}</p>
              )}
            </div>
            {/* رابط الجلسة القادمة */}
            <div className="space-y-2">
              <Label htmlFor="hearing-link">رابط الجلسة القادمة <span className="text-muted-foreground text-xs">(اختياري)</span></Label>
              <Input id="hearing-link" type="url" dir="ltr" placeholder="https://..." {...hearingForm.register("sessionLink")} />
              {hearingForm.formState.errors.sessionLink && (
                <p className="text-xs text-destructive">{hearingForm.formState.errors.sessionLink.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="hearing-attendance">الحضور</Label>
              <Input id="hearing-attendance" placeholder="مثال: المحامي ماجد السبيعي" {...hearingForm.register("attendance")} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hearing-lawsuit"
                className="w-4 h-4 accent-primary"
                {...hearingForm.register("requiresLawsuitEditing")}
              />
              <Label htmlFor="hearing-lawsuit" className="cursor-pointer">تتطلب تحرير دعوى</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hearing-reply-prep"
                className="w-4 h-4 accent-primary"
                {...hearingForm.register("requiresReplyPrep")}
              />
              <Label htmlFor="hearing-reply-prep" className="cursor-pointer">تتطلب تجهيز رد</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createHearing.isPending} className="w-full gap-2">
                {createHearing.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                جدولة الجلسة
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add execution dialog */}
      <Dialog open={isExecutionOpen} onOpenChange={setIsExecutionOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>طلب تنفيذ جديد</DialogTitle>
          </DialogHeader>
          <form onSubmit={executionForm.handleSubmit(onCreateExecution)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="exec-number">رقم التنفيذ</Label>
              <Input id="exec-number" placeholder="مثال: 447112233" {...executionForm.register("executionNumber")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exec-type">نوع التنفيذ</Label>
              <Input id="exec-type" placeholder="مثال: تنفيذ مالي / إخلاء عقار" {...executionForm.register("type")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exec-total">المبلغ الإجمالي (﷼) *</Label>
              <Input id="exec-total" type="number" min="0" step="0.01" dir="ltr" {...executionForm.register("totalAmount")} />
              {executionForm.formState.errors.totalAmount && (
                <p className="text-xs text-destructive">{executionForm.formState.errors.totalAmount.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="exec-paid">المبلغ المسدد (﷼)</Label>
              <Input id="exec-paid" type="number" min="0" step="0.01" dir="ltr" placeholder="0" {...executionForm.register("paidAmount")} />
              {executionForm.formState.errors.paidAmount && (
                <p className="text-xs text-destructive">{executionForm.formState.errors.paidAmount.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createExecution.isPending} className="w-full gap-2">
                {createExecution.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                إنشاء طلب التنفيذ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete document confirmation ──────────────────────────── */}
      <AlertDialog open={!!confirmDeleteDoc} onOpenChange={(open) => !open && setConfirmDeleteDoc(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              تأكيد حذف المستند
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              هل أنت متأكد من حذف المستند{" "}
              <span className="font-semibold text-foreground">"{confirmDeleteDoc?.name}"</span>؟
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">
                لن يُحذف المستند نهائياً — سيظل مسجلاً في سجل المستندات المحذوفة مع اسم من قام بالحذف.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              onClick={confirmDocDeleteAction}
            >
              {deleteDoc.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Clear court details confirmation ──────────────────────── */}
      <AlertDialog open={!!confirmClearCourtDetails} onOpenChange={(open) => !open && setConfirmClearCourtDetails(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              حذف بيانات المحكمة
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              هل أنت متأكد من حذف ملاحظة وتصنيف المستند{" "}
              <span className="font-semibold text-foreground">"{confirmClearCourtDetails?.fileName}"</span>؟
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">
                سيبقى الملف محفوظًا، وسيتم فقط إلغاء حالة رفعه للمحكمة وحذف نوع الرد والملاحظة.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              onClick={() => {
                if (!confirmClearCourtDetails) return;
                handleToggleSubmitted(confirmClearCourtDetails, false);
                setConfirmClearCourtDetails(null);
              }}
            >
              <Trash2 className="w-4 h-4" />
              حذف البيانات
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Pleading Preview Dialog ── */}
      <Dialog open={!!previewPleading} onOpenChange={(o) => { if (!o) setPreviewPleading(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col" dir="rtl">
          <DialogHeader className="border-b pb-3 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg">{previewPleading?.type || "مذكرة"}</DialogTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {previewPleading?.status === "DRAFT" ? (
                    <Badge variant="secondary" className="text-xs">مسودة</Badge>
                  ) : (
                    <Badge className="bg-emerald-500 text-xs">مقدمة</Badge>
                  )}
                  {previewPleading?.addedByName && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span>{previewPleading.addedByName}</span>
                      {(() => {
                        const rl = previewPleading?.addedByRole === "SYSTEM_MANAGER" ? "مدير النظام" : previewPleading?.addedByRole === "TECHNICIAN" ? "موظف" : null;
                        return rl ? <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0">{rl}</Badge> : null;
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DialogHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto py-4">
            {previewPleading?.content ? (
              <div className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap font-[inherit] text-foreground">
                {previewPleading.content}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">لا يوجد محتوى</p>
            )}
          </div>

          {/* Manager notes if any */}
          {(previewPleading as any)?.managerNotes && (
            <div className="border-t pt-3 mt-2 shrink-0">
              <p className="text-xs font-medium text-muted-foreground mb-1">ملاحظات المدير:</p>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{(previewPleading as any).managerNotes}</p>
            </div>
          )}

          <DialogFooter className="border-t pt-3 shrink-0">
            <Button variant="outline" onClick={() => setPreviewPleading(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Soft-delete case confirm ── */}
      <AlertDialog open={confirmDeleteCase} onOpenChange={setConfirmDeleteCase}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              تأكيد حذف القضية
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              هل أنت متأكد من حذف القضية{" "}
              <span className="font-semibold text-foreground">"{caseInfo.caseNumber || `#${caseInfo.id}`}"</span>؟
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">
                ستُعلَّم القضية كمحذوفة مع الاحتفاظ بجميع بياناتها — المذكرات، الجلسات، المستندات، والتنفيذات.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              onClick={handleSoftDeleteCase}
            >
              {deleteCase.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </AppLayout>
  );
}
