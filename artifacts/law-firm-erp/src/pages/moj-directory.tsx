import { useState, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useSearchMojDirectory,
  useUploadMojDirectory,
  getSearchMojDirectoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Mail,
  Copy,
  Upload,
  Loader2,
  Building2,
  CheckCheck,
  FileUp,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

const PAGE_SIZE = 50;

export default function MojDirectory() {
  const { isManager } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ─── Search + Pagination state ─────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setPage(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 350);
  }, []);

  const { data, isLoading } = useSearchMojDirectory({
    query: debouncedQuery,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const results = data?.results ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // ─── Copy email ─────────────────────────────────────────────────────────────
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = (id: number, email: string) => {
    navigator.clipboard.writeText(email).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // ─── PDF Upload (SYSTEM_MANAGER) ────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadMojDirectory();

  const handleFile = (file: File) => {
    if (file.type !== "application/pdf") {
      toast({ variant: "destructive", title: "يجب اختيار ملف PDF فقط" });
      return;
    }

    uploadMutation.mutate(
      { data: { file } },
      {
        onSuccess: (res) => {
          toast({ title: "✅ " + res.message });
          setPage(0);
          // Invalidate all search queries (prefix match) so the table refetches
          queryClient.invalidateQueries({ queryKey: getSearchMojDirectoryQueryKey() });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "فشل استيراد الملف. تحقق من صيغة الملف.";
          toast({ variant: "destructive", title: msg });
        },
      },
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">دليل الجهات القضائية</h2>
            <p className="text-muted-foreground mt-1">
              دليل البريد الإلكتروني لجهات وزارة العدل والدوائر القضائية
            </p>
          </div>
          <Badge variant="outline" className="text-xs border-primary/30 text-primary self-start sm:self-auto">
            {total.toLocaleString("ar-SA")} جهة
          </Badge>
        </div>

        {/* ─── Search Bar ─────────────────────────────────────────────────── */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="ابحث عن جهة قضائية، محكمة، أو إدارة..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="pr-10 text-right bg-card border-border/60 focus:border-primary/50 h-11 text-sm"
          />
          {isLoading && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* ─── Results Table ───────────────────────────────────────────────── */}
        <Card className="overflow-hidden border-border/60">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-right font-semibold w-8 px-4 py-3">#</TableHead>
                <TableHead className="text-right font-semibold px-4 py-3">
                  <div className="flex items-center justify-start gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>الجهة / المحكمة</span>
                  </div>
                </TableHead>
                <TableHead className="text-right font-semibold px-4 py-3">
                  <div className="flex items-center justify-start gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>البريد الإلكتروني</span>
                  </div>
                </TableHead>
                <TableHead className="text-center font-semibold w-36 px-4 py-3">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-40">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Building2 className="w-10 h-10 opacity-20" />
                      <p className="text-sm">
                        {debouncedQuery
                          ? `لا توجد نتائج للبحث عن "${debouncedQuery}"`
                          : "لا توجد بيانات. قم برفع ملف PDF لاستيراد الدليل."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                results.map((entry, idx) => (
                  <TableRow key={entry.id} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="text-muted-foreground text-xs font-mono text-right w-8 px-4 py-3">
                      {page * PAGE_SIZE + idx + 1}
                    </TableCell>
                    <TableCell className="font-medium text-right px-4 py-3">{entry.courtName}</TableCell>
                    <TableCell className="text-right px-4 py-3">
                      <span className="font-mono text-xs text-primary tracking-wide">
                        {entry.emailAddress}
                      </span>
                    </TableCell>
                    <TableCell className="w-36 px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopy(entry.id, entry.emailAddress)}
                          title="نسخ البريد الإلكتروني"
                        >
                          {copiedId === entry.id ? (
                            <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span className="hidden sm:inline">
                            {copiedId === entry.id ? "نُسخ" : "نسخ"}
                          </span>
                        </Button>

                        <Button
                          size="sm"
                          className="h-8 px-3 text-xs gap-1.5 bg-primary/90 hover:bg-primary text-primary-foreground"
                          asChild
                        >
                          <a
                            href={`mailto:${entry.emailAddress}`}
                            title={`مراسلة ${entry.courtName}`}
                          >
                            <Mail className="w-3.5 h-3.5" />
                            مراسلة
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* ─── Pagination ─────────────────────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 bg-muted/20">
              <span className="text-xs text-muted-foreground">
                صفحة {page + 1} من {totalPages} · إجمالي {total.toLocaleString("ar-SA")} جهة
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 gap-1 text-xs"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  السابق
                </Button>

                {/* Page number buttons (show up to 5 around current page) */}
                <div className="flex gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                    const pageNum = start + i;
                    return (
                      <Button
                        key={pageNum}
                        variant={pageNum === page ? "default" : "outline"}
                        size="sm"
                        className="h-8 w-8 p-0 text-xs"
                        onClick={() => setPage(pageNum)}
                      >
                        {pageNum + 1}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 gap-1 text-xs"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  التالي
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* ─── PDF Upload (SYSTEM_MANAGER only) ────────────────────────────── */}
        {isManager && (
          <Card className="border-dashed border-2 border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-right">
                <FileUp className="w-4 h-4 text-primary" />
                استيراد الدليل من PDF
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`
                  relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer
                  ${isDragging
                    ? "border-primary bg-primary/10 scale-[1.01]"
                    : "border-border/50 hover:border-primary/40 hover:bg-muted/30"
                  }
                `}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = "";
                  }}
                />

                {uploadMutation.isPending ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">جارٍ تحليل الملف واستخراج البيانات…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                      <Upload className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">اسحب ملف PDF هنا أو اضغط للاختيار</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        يقوم النظام تلقائياً باستخراج أسماء الجهات وعناوين البريد الإلكتروني
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-primary/30 text-primary hover:bg-primary/5 gap-2"
                      type="button"
                    >
                      <FileUp className="w-4 h-4" />
                      اختر ملف PDF
                    </Button>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground mt-3 text-center">
                ⚠️ سيتم مسح البيانات الحالية واستبدالها بالبيانات الجديدة من الملف
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
