import { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListConversations,
  useCreateConversation,
  useUpdateConversation,
  useDeleteConversation,
  useListConversationMessages,
  useAskInConversation,
  useUploadLegalDocument,
  useListLegalDocuments,
  useDeleteLegalDocument,
  useClearLegalIndex,
  getListConversationsQueryKey,
  getListConversationMessagesQueryKey,
  getListLegalDocumentsQueryKey,
  type ConversationSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sparkles,
  Send,
  Loader2,
  BookOpen,
  FileUp,
  Trash2,
  Bot,
  User as UserIcon,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  Plus,
  MessageSquare,
  Calendar,
  X,
  Pin,
  PinOff,
  Pencil,
  Check,
} from "lucide-react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from "date-fns";
import { arSA } from "date-fns/locale";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = { id: string; content: string; documentTitle: string };

// ─── Time filter ─────────────────────────────────────────────────────────────

type FilterPreset = "today" | "week" | "month" | "custom";

function getPresetRange(preset: FilterPreset): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  if (preset === "today") {
    return {
      dateFrom: startOfDay(now).toISOString(),
      dateTo: endOfDay(now).toISOString(),
    };
  }
  if (preset === "week") {
    return {
      dateFrom: startOfWeek(now, { weekStartsOn: 0 }).toISOString(),
      dateTo: endOfWeek(now, { weekStartsOn: 0 }).toISOString(),
    };
  }
  if (preset === "month") {
    return {
      dateFrom: startOfMonth(now).toISOString(),
      dateTo: endOfMonth(now).toISOString(),
    };
  }
  return {}; // custom — handled separately
}

// ─── SourcesSection ──────────────────────────────────────────────────────────

function SourcesSection({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <BookOpen className="h-3.5 w-3.5" />
        المصادر ({sources.length})
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <div
              key={s.id}
              className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed"
            >
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-primary">
                <FileText className="h-3 w-3" />
                {s.documentTitle}
              </div>
              <div className="text-muted-foreground" style={{ lineHeight: 1.8 }}>
                {s.content
                  .split(/\n{2,}/)
                  .filter((p) => p.trim().length > 0)
                  .map((para, j) => (
                    <p key={j} className="mb-2 whitespace-pre-wrap last:mb-0">
                      {para}
                    </p>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ConversationPanel (left sidebar) ────────────────────────────────────────

interface ConversationPanelProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  creating: boolean;
}

// ─── ConversationItem ─────────────────────────────────────────────────────────

interface ConversationItemProps {
  conv: ConversationSummary;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onUpdated: () => void;
  onDeleted: (id: number) => void;
}

function ConversationItem({ conv, isSelected, onSelect, onUpdated, onDeleted }: ConversationItemProps) {
  const { toast } = useToast();
  const updateMutation = useUpdateConversation();
  const deleteMutation = useDeleteConversation();

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when rename mode activates
  useEffect(() => {
    if (isRenaming) {
      setRenameValue(conv.title);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isRenaming, conv.title]);

  const commitRename = () => {
    const trimmed = renameValue.trim();
    setIsRenaming(false);
    if (!trimmed || trimmed === conv.title) return;
    updateMutation.mutate(
      { id: conv.id, data: { title: trimmed } },
      {
        onSuccess: onUpdated,
        onError: () => toast({ variant: "destructive", title: "فشل تغيير الاسم" }),
      },
    );
  };

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateMutation.mutate(
      { id: conv.id, data: { isPinned: !conv.isPinned } },
      {
        onSuccess: onUpdated,
        onError: () => toast({ variant: "destructive", title: "فشل تثبيت المحادثة" }),
      },
    );
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteMutation.mutate(
      { id: conv.id },
      {
        onSuccess: () => {
          onDeleted(conv.id);
          toast({ title: "تم حذف المحادثة" });
        },
        onError: () => toast({ variant: "destructive", title: "فشل حذف المحادثة" }),
      },
    );
  };

  return (
    <li>
      <div
        onClick={() => !isRenaming && onSelect(conv.id)}
        className={cn(
          "group relative w-full text-right px-3 py-2.5 hover:bg-muted/60 transition-colors flex flex-col gap-0.5 cursor-pointer",
          isSelected && "bg-primary/10 border-e-2 border-primary",
          conv.isPinned && "bg-amber-50/50 dark:bg-amber-950/20",
        )}
      >
        {/* Pin indicator strip */}
        {conv.isPinned && (
          <span className="absolute start-0 top-0 h-full w-0.5 bg-amber-400/70 rounded-full" />
        )}

        <div className="flex items-start justify-between gap-1">
          {isRenaming ? (
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                if (e.key === "Escape") { setIsRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 rounded border border-primary/40 bg-background px-1.5 py-0.5 text-xs font-medium outline-none focus:ring-1 focus:ring-primary/50"
              maxLength={120}
            />
          ) : (
            <p className="text-xs font-medium leading-snug line-clamp-2 flex-1 min-w-0">
              {conv.title}
            </p>
          )}

          {/* Action buttons — visible on hover (or always if pinned) */}
          <div className={cn(
            "flex items-center gap-0.5 shrink-0 transition-opacity",
            conv.isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}>
            {isRenaming ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); commitRename(); }}
                className="p-0.5 rounded text-primary hover:bg-primary/10"
                aria-label="حفظ الاسم"
              >
                <Check className="h-3 w-3" />
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setIsRenaming(true); }}
                className="p-0.5 rounded hover:text-primary transition-colors"
                aria-label="إعادة التسمية"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={togglePin}
              className={cn(
                "p-0.5 rounded transition-colors",
                conv.isPinned ? "text-amber-500 hover:text-amber-600" : "hover:text-amber-500",
              )}
              aria-label={conv.isPinned ? "إلغاء التثبيت" : "تثبيت المحادثة"}
            >
              {conv.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="p-0.5 rounded hover:text-destructive transition-colors"
              aria-label="حذف المحادثة"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        <span className="text-[10px] text-muted-foreground">
          {format(new Date(conv.createdAt), "d MMM yyyy، h:mm a", { locale: arSA })}
        </span>
      </div>
    </li>
  );
}

// ─── ConversationPanel ────────────────────────────────────────────────────────

function ConversationPanel({ selectedId, onSelect, onNew, creating }: ConversationPanelProps) {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<FilterPreset>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const filterParams =
    preset === "custom"
      ? {
          dateFrom: customFrom ? new Date(customFrom).toISOString() : undefined,
          dateTo: customTo ? endOfDay(new Date(customTo)).toISOString() : undefined,
        }
      : getPresetRange(preset);

  const { data: conversations, isLoading } = useListConversations(filterParams);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });

  // Sort: pinned first, then by date descending
  const sorted = conversations
    ? [...conversations].sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
    : [];

  const presets: { key: FilterPreset; label: string }[] = [
    { key: "today", label: "اليوم" },
    { key: "week", label: "الأسبوع" },
    { key: "month", label: "الشهر" },
    { key: "custom", label: "مخصص" },
  ];

  return (
    <div className="flex h-full flex-col border-e bg-muted/20">
      {/* Header */}
      <div className="border-b p-3">
        <Button size="sm" className="w-full gap-2" onClick={onNew} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          محادثة جديدة
        </Button>
      </div>

      {/* Time filter */}
      <div className="border-b p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
          <Calendar className="h-3.5 w-3.5" />
          الفترة الزمنية
        </div>
        <div className="grid grid-cols-2 gap-1">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                preset === p.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-background border hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="space-y-1.5 pt-1">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">من</label>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">إلى</label>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-7 text-xs" />
            </div>
          </div>
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">لا توجد محادثات في هذه الفترة</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {sorted.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isSelected={selectedId === conv.id}
                onSelect={onSelect}
                onUpdated={refresh}
                onDeleted={refresh}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── ChatArea ─────────────────────────────────────────────────────────────────

interface ChatAreaProps {
  conversationId: number;
}

function ChatArea({ conversationId }: ChatAreaProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const askMutation = useAskInConversation();

  const { data: messages, isLoading } = useListConversationMessages(conversationId, {
    query: { queryKey: getListConversationMessagesQueryKey(conversationId) },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, askMutation.isPending]);

  const handleSend = () => {
    const prompt = input.trim();
    if (!prompt || askMutation.isPending) return;
    setInput("");
    askMutation.mutate(
      { id: conversationId, data: { prompt } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConversationMessagesQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "حدث خطأ أثناء معالجة السؤال. حاول مرة أخرى.";
          toast({ variant: "destructive", title: msg });
          setInput(prompt);
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {(!messages || messages.length === 0) && !askMutation.isPending && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">محادثة جديدة</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              اسأل عن الأنظمة واللوائح السعودية المفهرسة، وسيجيب المساعد استناداً إلى نصوص الأنظمة فقط مع عرض المصادر.
            </p>
          </div>
        )}

        {messages?.map((msg, i) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-start">
              <div className="flex max-w-[85%] items-start gap-2.5">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <UserIcon className="h-4 w-4 text-secondary-foreground" />
                </div>
                <div className="rounded-2xl rounded-tr-sm bg-secondary px-4 py-2.5 text-sm leading-relaxed text-secondary-foreground">
                  {msg.content}
                </div>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-end">
              <div className="flex max-w-[85%] flex-row-reverse items-start gap-2.5">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-primary/20 bg-card px-4 py-3 text-sm leading-relaxed shadow-sm">
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <SourcesSection sources={(msg.sources as Source[]) ?? []} />
                </div>
              </div>
            </div>
          ),
        )}

        {/* Optimistic pending bubble */}
        {askMutation.isPending && (
          <>
            {/* User bubble (optimistic) */}
            <div className="flex justify-start">
              <div className="flex max-w-[85%] items-start gap-2.5">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <UserIcon className="h-4 w-4 text-secondary-foreground" />
                </div>
                <div className="rounded-2xl rounded-tr-sm bg-secondary px-4 py-2.5 text-sm leading-relaxed text-secondary-foreground opacity-60">
                  {(askMutation.variables as any)?.data?.prompt ?? ""}
                </div>
              </div>
            </div>
            {/* Assistant loading bubble */}
            <div className="flex justify-end">
              <div className="flex max-w-[85%] flex-row-reverse items-start gap-2.5">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-primary/20 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  جارٍ البحث في الأنظمة وصياغة الإجابة...
                </div>
              </div>
            </div>
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-muted/30 p-3 md:p-4 shrink-0">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="اكتب سؤالك القانوني هنا... (Enter للإرسال، Shift+Enter لسطر جديد)"
            className="min-h-[52px] max-h-40 flex-1 resize-none"
            data-testid="input-question"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || askMutation.isPending}
            size="icon"
            className="h-[52px] w-[52px] shrink-0"
            data-testid="button-send"
          >
            {askMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5 -scale-x-100" />
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

// ─── ChatTab ─────────────────────────────────────────────────────────────────

function ChatTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const createMutation = useCreateConversation();

  const handleNew = () => {
    const title = "محادثة جديدة";
    createMutation.mutate(
      { data: { title } },
      {
        onSuccess: (conv) => {
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          setSelectedId(conv.id);
        },
        onError: () => toast({ variant: "destructive", title: "فشل إنشاء المحادثة" }),
      },
    );
  };

  // Auto-create first conversation on first load
  const hasAutoCreated = useRef(false);

  return (
    <Card className="flex h-[calc(100vh-16rem)] flex-col overflow-hidden border-primary/20">
      <CardContent className="flex flex-1 flex-col gap-0 overflow-hidden p-0">
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 shrink-0 overflow-hidden">
            <ConversationPanel
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNew={handleNew}
              creating={createMutation.isPending}
            />
          </div>

          {/* Main chat area */}
          <div className="flex flex-1 flex-col overflow-hidden border-s">
            {selectedId === null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="h-10 w-10 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold">المساعد القانوني الذكي</h3>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    اختر محادثة من القائمة أو أنشئ محادثة جديدة للبدء.
                  </p>
                </div>
                <Button className="gap-2 mt-2" onClick={handleNew} disabled={createMutation.isPending}>
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  ابدأ محادثة جديدة
                </Button>
              </div>
            ) : (
              <ChatArea key={selectedId} conversationId={selectedId} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── UploadTab ────────────────────────────────────────────────────────────────

function UploadTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents, isLoading } = useListLegalDocuments();
  const uploadMutation = useUploadLegalDocument();
  const deleteMutation = useDeleteLegalDocument();
  const clearIndexMutation = useClearLegalIndex();

  const handleClearIndex = () => {
    clearIndexMutation.mutate(undefined, {
      onSuccess: (res) => {
        toast({ title: `تم مسح جميع الفهارس (${res.deletedDocuments} مستند)` });
        queryClient.invalidateQueries({ queryKey: getListLegalDocumentsQueryKey() });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? "فشل مسح الفهارس. حاول مرة أخرى.";
        toast({ variant: "destructive", title: msg });
      },
    });
  };

  const handleFile = (file: File) => {
    const isPdf = file.type === "application/pdf";
    const isTxt = file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
    if (!isPdf && !isTxt) {
      toast({ variant: "destructive", title: "يجب اختيار ملف PDF أو ملف نصي فقط" });
      return;
    }
    uploadMutation.mutate(
      { data: { file } },
      {
        onSuccess: (res) => {
          toast({ title: `✅ تم فهرسة "${res.title}" (${res.chunkCount} مقطع)` });
          queryClient.invalidateQueries({ queryKey: getListLegalDocumentsQueryKey() });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "فشل رفع الملف. حاول مرة أخرى.";
          toast({ variant: "destructive", title: msg });
        },
      },
    );
  };

  const handleFiles = (fileList: FileList | File[]) => {
    Array.from(fileList).forEach(handleFile);
  };

  const handleDelete = (id: string, title: string) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: `تم حذف "${title}"` });
          queryClient.invalidateQueries({ queryKey: getListLegalDocumentsQueryKey() });
        },
        onError: () => {
          toast({ variant: "destructive", title: "فشل حذف المستند" });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card
        className={`border-2 border-dashed transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
        }}
      >
        <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          {uploadMutation.isPending ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">
                جارٍ استخراج النص وتقسيمه وفهرسته... قد يستغرق ذلك دقيقة
              </p>
            </>
          ) : (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <FileUp className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-medium">اسحب ملف نظام أو لائحة هنا</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF أو TXT — سيتم تقسيمه وفهرسته تلقائياً للبحث الدلالي
                </p>
              </div>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="ml-2 h-4 w-4" />
                اختيار ملفات
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) handleFiles(files);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-primary" />
            المستندات المفهرسة
          </CardTitle>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={clearIndexMutation.isPending || !documents || documents.length === 0}
              >
                {clearIndexMutation.isPending ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="ml-2 h-4 w-4" />
                )}
                مسح جميع الفهارس
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  مسح جميع الفهارس القانونية؟
                </AlertDialogTitle>
                <AlertDialogDescription>
                  سيتم حذف جميع المستندات المفهرسة ({documents?.length ?? 0} مستند) وكافة
                  المقاطع والمتجهات المرتبطة بها نهائياً. لا يمكن التراجع عن هذا الإجراء،
                  وسيتوقف المساعد عن الإجابة حتى يتم رفع مستندات جديدة.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearIndex}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  نعم، امسح الكل
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : !documents || documents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              لا توجد مستندات مفهرسة بعد
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(doc.uploadedAt).toLocaleDateString("ar-SA")}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {doc.chunkCount} مقطع
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(doc.id, doc.title)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiAssistant() {
  const { isManager } = useAuth();

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">المساعد القانوني</h1>
            <p className="text-sm text-muted-foreground">
              إجابات مستندة إلى الأنظمة واللوائح المفهرسة — المحادثات محفوظة تلقائياً
            </p>
          </div>
        </div>

        {isManager ? (
          <Tabs defaultValue="chat" dir="rtl">
            <TabsList>
              <TabsTrigger value="chat">
                <Sparkles className="ml-2 h-4 w-4" />
                المحادثات
              </TabsTrigger>
              <TabsTrigger value="upload">
                <FileUp className="ml-2 h-4 w-4" />
                إدارة المستندات
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="mt-4">
              <ChatTab />
            </TabsContent>
            <TabsContent value="upload" className="mt-4">
              <UploadTab />
            </TabsContent>
          </Tabs>
        ) : (
          <ChatTab />
        )}
      </div>
    </AppLayout>
  );
}
