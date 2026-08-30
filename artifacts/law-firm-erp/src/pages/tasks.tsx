import { useState } from "react";
import {
  useListTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useListUsers,
  useListCases,
  useListContracts,
  useListClients,
  useListExecutions,
  useGetSystemSetting,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Loader2, ClipboardList, Scale, CircleCheck, Circle, Trash2, RotateCcw,
  CalendarClock, User, UserPlus, ArrowLeft, ChevronsUpDown, Check, Link2, EyeOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

const taskSchema = z.object({
  title: z.string().min(1, "عنوان المهمة مطلوب"),
  description: z.string().optional(),
  dueDate: z.string().min(1, "تاريخ ووقت الاستحقاق مطلوب"),
  assignedToId: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskSchema>;
type Timeframe = "today" | "week" | "month" | undefined;

const TIMEFRAME_FILTERS: { label: string; value: Timeframe }[] = [
  { label: "مهام اليوم", value: "today" },
  { label: "مهام الأسبوع", value: "week" },
  { label: "مهام الشهر", value: "month" },
  { label: "الكل", value: undefined },
];

// ─── Resource types for link picker ──────────────────────────────────────────

type LinkResourceType = "none" | "case" | "contract" | "client" | "execution";

const LINK_RESOURCE_LABELS: Record<LinkResourceType, string> = {
  none: "بدون ربط",
  case: "قضية",
  contract: "عقد",
  client: "عميل",
  execution: "تنفيذ",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Tasks() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("today");
  const [showAll, setShowAll] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  // Link picker state
  const [linkResourceType, setLinkResourceType] = useState<LinkResourceType>("none");
  const [linkResourceId, setLinkResourceId] = useState<string>("");
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const { user, isManager } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tasks, isLoading } = useListTasks({
    ...(timeframe ? { timeframe } : {}),
    show_all: showAll,
    show_deleted: showDeleted,
  });
  const { data: users } = useListUsers();

  // Resources for link picker
  const { data: cases } = useListCases({});
  const { data: contracts } = useListContracts({});
  const { data: clients } = useListClients({});
  const { data: executions } = useListExecutions({});

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", description: "", dueDate: "", assignedToId: "" },
  });

  // Build linkUrl from selected resource
  const buildLinkUrl = (): string | null => {
    if (linkResourceType === "none" || !linkResourceId) return null;
    switch (linkResourceType) {
      case "case":      return `/cases/${linkResourceId}`;
      case "contract":  return `/contracts`;
      case "client":    return `/clients/${linkResourceId}`;
      case "execution": return `/executions`;
      default: return null;
    }
  };

  // Label for currently selected resource
  const selectedResourceLabel = (): string => {
    if (linkResourceType === "none" || !linkResourceId) return "";
    const id = parseInt(linkResourceId, 10);
    switch (linkResourceType) {
      case "case": {
        const c = cases?.find((x) => x.id === id);
        return c ? (c.caseNumber || `قضية #${c.id}`) + (c.clientName ? ` — ${c.clientName}` : "") : `#${id}`;
      }
      case "contract": {
        const c = contracts?.find((x) => x.id === id);
        return c ? `${c.clientName} — ${c.serviceType}` : `#${id}`;
      }
      case "client": {
        const c = clients?.find((x) => x.id === id);
        return c ? c.name : `#${id}`;
      }
      case "execution": {
        const e = executions?.find((x) => x.id === id);
        return e ? `تنفيذ #${e.id}` + (e.executionNumber ? ` — ${e.executionNumber}` : "") : `#${id}`;
      }
      default: return "";
    }
  };

  // Options list for current resource type
  const resourceOptions = (): { value: string; label: string }[] => {
    switch (linkResourceType) {
      case "case":
        return (cases ?? []).map((c) => ({
          value: String(c.id),
          label: (c.caseNumber || `قضية #${c.id}`) + (c.clientName ? ` — ${c.clientName}` : "") + (c.subject ? ` | ${c.subject}` : ""),
        }));
      case "contract":
        return (contracts ?? []).map((c) => ({
          value: String(c.id),
          label: `${c.clientName} — ${c.serviceType}`,
        }));
      case "client":
        return (clients ?? []).map((c) => ({
          value: String(c.id),
          label: c.name,
        }));
      case "execution":
        return (executions ?? []).map((e) => ({
          value: String(e.id),
          label: `تنفيذ #${e.id}` + (e.executionNumber ? ` — ${e.executionNumber}` : ""),
        }));
      default:
        return [];
    }
  };

  const resetDialog = () => {
    form.reset();
    setLinkResourceType("none");
    setLinkResourceId("");
    setLinkPickerOpen(false);
  };

  const onSubmit = async (data: TaskFormValues) => {
    try {
      await createTask.mutateAsync({
        data: {
          title: data.title,
          description: data.description || null,
          dueDate: new Date(data.dueDate).toISOString(),
          assignedToId: data.assignedToId && data.assignedToId !== "team"
            ? parseInt(data.assignedToId, 10)
            : null,
          linkUrl: buildLinkUrl(),
        },
      });
      invalidate();
      toast({ title: "✅ تم إنشاء المهمة بنجاح" });
      setIsDialogOpen(false);
      resetDialog();
    } catch {
      toast({ variant: "destructive", title: "فشل إنشاء المهمة" });
    }
  };

  const toggleStatus = async (id: number, current: string) => {
    try {
      await updateTask.mutateAsync({
        id,
        data: { status: current === "PENDING" ? "COMPLETED" : "PENDING" },
      });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث حالة المهمة" });
    }
  };

  const handleDelete = async (id: number, isDeleted: boolean) => {
    try {
      await deleteTask.mutateAsync({ id });
      invalidate();
      toast({ title: isDeleted ? "تمت استعادة المهمة" : "تم تأشير المهمة كمحذوفة" });
    } catch {
      toast({ variant: "destructive", title: "لا يمكنك تنفيذ هذا الإجراء" });
    }
  };

  const pendingCount = tasks?.filter((t) => t.status === "PENDING").length ?? 0;

  const { data: tasksSetting, isLoading: isSettingLoading } = useGetSystemSetting("TASKS_MODULE_VISIBLE");
  if (!isSettingLoading && tasksSetting?.value === false) {
    return <Redirect to="/dashboard" />;
  }

  const options = resourceOptions();
  const selLabel = selectedResourceLabel();

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">المهام المشتركة</h2>
            <p className="text-muted-foreground mt-1">
              {pendingCount > 0 ? `${pendingCount} مهمة قيد التنفيذ` : "لا توجد مهام معلقة"}
            </p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(o) => { setIsDialogOpen(o); if (!o) resetDialog(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                مهمة جديدة
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md" dir="rtl">
              <DialogHeader>
                <DialogTitle>إسناد مهمة جديدة</DialogTitle>
              </DialogHeader>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Title */}
                <div className="space-y-2">
                  <Label htmlFor="title">عنوان المهمة *</Label>
                  <Input id="title" placeholder="مثال: إعداد مذكرة الرد" {...form.register("title")} />
                  {form.formState.errors.title && (
                    <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">الوصف</Label>
                  <Textarea id="description" rows={2} placeholder="تفاصيل إضافية..." {...form.register("description")} />
                </div>

                {/* Due date */}
                <div className="space-y-2">
                  <Label htmlFor="dueDate">تاريخ ووقت الاستحقاق *</Label>
                  <Input id="dueDate" type="datetime-local" {...form.register("dueDate")} />
                  {form.formState.errors.dueDate && (
                    <p className="text-xs text-destructive">{form.formState.errors.dueDate.message}</p>
                  )}
                </div>

                {/* Assign to */}
                <div className="space-y-2">
                  <Label>إسناد إلى</Label>
                  <Select
                    value={form.watch("assignedToId") || "team"}
                    onValueChange={(v) => form.setValue("assignedToId", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر عضو الفريق" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="team">الفريق بأكمله</SelectItem>
                      {users?.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* ── Link to resource ── */}
                <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Link2 className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">ربط المهمة بـ</Label>
                    <span className="text-xs text-muted-foreground">(اختياري — لتوجيه المستخدم)</span>
                  </div>

                  {/* Resource type */}
                  <Select
                    value={linkResourceType}
                    onValueChange={(v) => { setLinkResourceType(v as LinkResourceType); setLinkResourceId(""); }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LINK_RESOURCE_LABELS) as LinkResourceType[]).map((k) => (
                        <SelectItem key={k} value={k}>{LINK_RESOURCE_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Resource picker combobox */}
                  {linkResourceType !== "none" && (
                    <Popover open={linkPickerOpen} onOpenChange={setLinkPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-normal text-right h-9"
                          dir="rtl"
                        >
                          <span className={selLabel ? "truncate text-sm" : "text-muted-foreground text-sm"}>
                            {selLabel || `ابحث عن ${LINK_RESOURCE_LABELS[linkResourceType]}...`}
                          </span>
                          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 shrink-0 mr-2" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" dir="rtl" align="start">
                        <Command>
                          <CommandInput placeholder={`ابحث عن ${LINK_RESOURCE_LABELS[linkResourceType]}...`} className="text-right" />
                          <CommandList>
                            <CommandEmpty>لا توجد نتائج</CommandEmpty>
                            {options.map((opt) => (
                              <CommandItem
                                key={opt.value}
                                value={opt.label}
                                onSelect={() => { setLinkResourceId(opt.value); setLinkPickerOpen(false); }}
                                className="flex items-center justify-between cursor-pointer"
                              >
                                <span className="truncate">{opt.label}</span>
                                {linkResourceId === opt.value && <Check className="w-4 h-4 text-primary shrink-0 ml-2" />}
                              </CommandItem>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                <DialogFooter>
                  <Button type="submit" disabled={createTask.isPending} className="w-full gap-2">
                    {createTask.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    إنشاء المهمة
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 bg-card border rounded-lg px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            {TIMEFRAME_FILTERS.map((f) => (
              <Button
                key={f.label}
                size="sm"
                variant={timeframe === f.value ? "default" : "outline"}
                onClick={() => setTimeframe(f.value)}
                className="h-8"
              >
                {f.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
              <Label htmlFor="show-all" className="text-sm cursor-pointer">إظهار مهام الجميع</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="show-deleted"
                checked={showDeleted}
                onCheckedChange={setShowDeleted}
                className="data-[state=checked]:bg-muted-foreground"
              />
              <Label htmlFor="show-deleted" className="text-sm cursor-pointer flex items-center gap-1.5 text-muted-foreground">
                <EyeOff className="w-3.5 h-3.5" />
                إظهار المحذوفة
              </Label>
            </div>
          </div>
        </div>

        {/* Task cards */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : !tasks || tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground bg-card border rounded-lg">
            <ClipboardList className="w-12 h-12 mb-4 opacity-20" />
            <p>لا توجد مهام ضمن هذا النطاق</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {tasks.map((task) => {
              const isCompleted = task.status === "COMPLETED";
              const isDeleted = !!task.deletedAt;
              const isOverdue = !isCompleted && !isDeleted && new Date(task.dueDate) < new Date();
              const canDelete = isManager || task.assignedById === user?.id;

              // Resolve navigation target
              const navUrl = task.linkUrl ?? null;
              const isHearingTask = task.taskType === "HEARING_AUTO";

              return (
                <div
                  key={task.id}
                  className={[
                    "group relative bg-card border rounded-lg p-4 shadow-sm transition-all hover:shadow-md",
                    isDeleted
                      ? "opacity-50 border-dashed border-muted-foreground/30 bg-muted/20"
                      : isCompleted
                      ? "opacity-60"
                      : "",
                    isOverdue && !isDeleted ? "border-destructive/40" : "",
                  ].join(" ")}
                >
                  {/* Deleted overlay label */}
                  {isDeleted && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-lg overflow-hidden">
                      <span className="rotate-[-18deg] text-[11px] font-bold tracking-widest uppercase text-muted-foreground/30 select-none text-center leading-tight px-2">
                        تم الحذف
                      </span>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    {/* Status toggle — disabled when deleted */}
                    <button
                      onClick={() => !isDeleted && toggleStatus(task.id, task.status)}
                      disabled={isDeleted}
                      className={`mt-0.5 shrink-0 transition-transform ${isDeleted ? "cursor-not-allowed opacity-30" : "text-primary hover:scale-110"}`}
                      title={isDeleted ? "المهمة محذوفة" : isCompleted ? "إعادة فتح المهمة" : "تحديد كمنجزة"}
                    >
                      {isCompleted ? (
                        <CircleCheck className="w-6 h-6 text-emerald-500" />
                      ) : (
                        <Circle className="w-6 h-6" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      {/* Title + badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-bold text-base ${isCompleted || isDeleted ? "line-through" : ""} ${isDeleted ? "text-muted-foreground" : ""}`}>
                          {task.title}
                        </h3>
                        {isDeleted ? (
                          <Badge variant="outline" className="text-muted-foreground border-muted-foreground/40 gap-1 text-[10px]">
                            <Trash2 className="w-2.5 h-2.5" />
                            تم الحذف
                          </Badge>
                        ) : isHearingTask ? (
                          <Badge className="bg-primary/15 text-primary hover:bg-primary/20 gap-1 border border-primary/30">
                            <Scale className="w-3 h-3" />
                            جلسة
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <ClipboardList className="w-3 h-3" />
                            يدوية
                          </Badge>
                        )}
                        {isOverdue && (
                          <Badge variant="outline" className="text-destructive border-destructive/50">
                            متأخرة
                          </Badge>
                        )}
                      </div>

                      {/* Description */}
                      {task.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                      )}

                      {/* Meta row */}
                      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2.5 text-xs text-muted-foreground">
                        <span className={`flex items-center gap-1.5 font-medium ${isOverdue ? "text-destructive" : "text-foreground/80"}`}>
                          <CalendarClock className="w-3.5 h-3.5" />
                          {format(new Date(task.dueDate), "EEEE d MMMM yyyy — hh:mm a", { locale: arSA })}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" />
                          {task.assignedToName || "الفريق بأكمله"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <UserPlus className="w-3.5 h-3.5" />
                          بواسطة: {task.assignedByName || "غير معروف"}
                        </span>
                        <span>
                          أُنشئت {format(new Date(task.createdAt), "d MMM yyyy — hh:mm a", { locale: arSA })}
                        </span>
                        {isDeleted && task.deletedAt && (
                          <span className="flex items-center gap-1.5 text-muted-foreground/70">
                            <Trash2 className="w-3 h-3" />
                            حُذفت {format(new Date(task.deletedAt), "d MMM yyyy — hh:mm a", { locale: arSA })}
                          </span>
                        )}
                      </div>

                      {/* Navigation button — only when not deleted and not completed */}
                      {navUrl && !isCompleted && !isDeleted && (
                        <button
                          onClick={() => navigate(navUrl)}
                          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 hover:underline transition-colors"
                        >
                          {isHearingTask ? (
                            <>
                              <Scale className="w-3.5 h-3.5" />
                              الانتقال إلى الجلسة
                            </>
                          ) : (
                            <>
                              <ArrowLeft className="w-3.5 h-3.5" />
                              الانتقال لإتمام المهمة
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Delete / Restore */}
                    {canDelete && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className={`opacity-0 group-hover:opacity-100 transition-opacity shrink-0 h-8 w-8 ${
                          isDeleted
                            ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                            : "text-muted-foreground hover:text-destructive"
                        }`}
                        onClick={() => handleDelete(task.id, isDeleted)}
                        title={isDeleted ? "استعادة المهمة" : "حذف المهمة (مع إمكانية الاسترجاع)"}
                      >
                        {isDeleted ? <RotateCcw className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
