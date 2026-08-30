import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetMeeting,
  useUpdateMeeting,
  useAddParticipants,
  useRemoveParticipant,
  useUpdateRsvp,
  useToggleEditPermission,
  useAddAgendaItem,
  useUpdateAgendaItem,
  useDeleteAgendaItem,
  useListUsers,
  type MeetingParticipant,
  type MeetingAgendaItem,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Check,
  CheckSquare,
  Square,
  ExternalLink,
  Users,
  ChevronDown,
  X,
  Pen,
  Clock,
  Video,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hijriDateFull(iso: string) {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function gregorianDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function timeStr(iso: string) {
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

const RSVP_OPTIONS: { value: "ATTENDING" | "DECLINED" | "UNCERTAIN"; label: string; color: string }[] = [
  { value: "ATTENDING", label: "سيحضر ✓", color: "bg-emerald-500 hover:bg-emerald-600" },
  { value: "UNCERTAIN", label: "غير متأكد ؟", color: "bg-amber-500 hover:bg-amber-600" },
  { value: "DECLINED", label: "معتذر ✗", color: "bg-destructive hover:bg-destructive/90" },
];

const RSVP_BADGE: Record<string, string> = {
  ATTENDING: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  DECLINED: "bg-destructive/10 text-destructive border-destructive/20",
  UNCERTAIN: "bg-amber-500/10 text-amber-700 border-amber-200",
  PENDING: "bg-muted text-muted-foreground border-border",
};

const RSVP_LABEL: Record<string, string> = {
  ATTENDING: "سيحضر",
  DECLINED: "معتذر",
  UNCERTAIN: "غير متأكد",
  PENDING: "لم يرد",
};

// ─── Schemas ──────────────────────────────────────────────────────────────────

const agendaItemSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب"),
  description: z.string().optional(),
});

const editMeetingSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب"),
  description: z.string().optional(),
  meetingLink: z.string().url("رابط غير صحيح").optional().or(z.literal("")),
  scheduledDate: z.string().min(1),
  scheduledTime: z.string().min(1),
  reminderMinutes: z.coerce.number().min(1),
});

type AgendaItemForm = z.infer<typeof agendaItemSchema>;
type EditMeetingForm = z.infer<typeof editMeetingSchema>;

const REMINDER_OPTIONS = [
  { label: "5 دقائق", value: 5 },
  { label: "10 دقائق", value: 10 },
  { label: "15 دقيقة", value: 15 },
  { label: "30 دقيقة", value: 30 },
  { label: "ساعة", value: 60 },
  { label: "ساعتان", value: 120 },
  { label: "يوم كامل", value: 1440 },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MeetingDetail() {
  const params = useParams<{ id: string }>();
  const meetingId = parseInt(params.id ?? "0", 10);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: meeting, isLoading } = useGetMeeting(meetingId);
  const { data: allUsers } = useListUsers({});

  const updateMeeting = useUpdateMeeting(meetingId);
  const addParticipants = useAddParticipants(meetingId);
  const removeParticipant = useRemoveParticipant(meetingId);
  const updateRsvp = useUpdateRsvp(meetingId);
  const togglePermission = useToggleEditPermission(meetingId);
  const addAgenda = useAddAgendaItem(meetingId);
  const updateAgenda = useUpdateAgendaItem(meetingId);
  const deleteAgenda = useDeleteAgendaItem(meetingId);

  // UI state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddAgendaOpen, setIsAddAgendaOpen] = useState(false);
  const [editingAgenda, setEditingAgenda] = useState<MeetingAgendaItem | null>(null);
  const [deletingAgendaId, setDeletingAgendaId] = useState<number | null>(null);
  const [removingParticipantId, setRemovingParticipantId] = useState<number | null>(null);
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<number[]>([]);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [activeRsvpSection, setActiveRsvpSection] = useState<string | null>(null);

  const currentUserId = user?.id ?? 0;
  const isManager = user?.role === "SYSTEM_MANAGER";
  const isCreator = meeting?.createdById === currentUserId;
  const canManage = isManager || isCreator;

  const myParticipant = meeting?.participants.find(
    (p) => p.userId === currentUserId,
  );

  // Agenda permission checks
  function canEditAgendaItem(item: MeetingAgendaItem) {
    if (isManager || isCreator) return true;
    if (item.createdById === currentUserId) return true;
    const p = meeting?.participants.find((pp) => pp.userId === currentUserId);
    return p?.canEditAllAgenda ?? false;
  }

  function canDeleteAgendaItem(item: MeetingAgendaItem) {
    return isManager || isCreator || item.createdById === currentUserId;
  }

  function canToggleDone(item: MeetingAgendaItem) {
    return isManager || isCreator || item.createdById === currentUserId;
  }

  // RSVP counts
  const rsvpCounts = {
    ATTENDING: meeting?.participants.filter((p) => p.rsvpStatus === "ATTENDING").length ?? 0,
    DECLINED: meeting?.participants.filter((p) => p.rsvpStatus === "DECLINED").length ?? 0,
    UNCERTAIN: meeting?.participants.filter((p) => p.rsvpStatus === "UNCERTAIN").length ?? 0,
    PENDING: meeting?.participants.filter((p) => p.rsvpStatus === "PENDING").length ?? 0,
  };

  // Participant picker: exclude already in meeting
  const existingIds = new Set(meeting?.participants.map((p) => p.userId) ?? []);
  const availableUsers = (allUsers ?? []).filter((u) => !existingIds.has(u.id));
  const managers = availableUsers.filter((u) => u.role === "SYSTEM_MANAGER");
  const technicians = availableUsers.filter((u) => u.role === "TECHNICIAN");

  // Edit meeting form
  const scheduledDate = meeting?.scheduledAt
    ? new Date(meeting.scheduledAt).toISOString().split("T")[0]
    : "";
  const scheduledTime = meeting?.scheduledAt
    ? new Date(meeting.scheduledAt).toTimeString().slice(0, 5)
    : "";

  const editForm = useForm<EditMeetingForm>({
    resolver: zodResolver(editMeetingSchema),
    values: {
      title: meeting?.title ?? "",
      description: meeting?.description ?? "",
      meetingLink: meeting?.meetingLink ?? "",
      scheduledDate,
      scheduledTime,
      reminderMinutes: meeting?.reminderMinutes ?? 15,
    },
  });

  const agendaForm = useForm<AgendaItemForm>({
    resolver: zodResolver(agendaItemSchema),
    defaultValues: { title: "", description: "" },
  });

  const agendaEditForm = useForm<AgendaItemForm & { recommendations?: string }>({
    defaultValues: { title: "", description: "", recommendations: "" },
  });

  // ── Handlers ──

  async function handleUpdateMeeting(values: EditMeetingForm) {
    try {
      const scheduledAt = new Date(
        `${values.scheduledDate}T${values.scheduledTime}`,
      ).toISOString();
      await updateMeeting.mutateAsync({
        title: values.title,
        description: values.description || null,
        meetingLink: values.meetingLink || null,
        scheduledAt,
        reminderMinutes: values.reminderMinutes,
      });
      toast({ title: "تم تحديث الاجتماع" });
      setIsEditOpen(false);
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    }
  }

  async function handleRsvp(status: "ATTENDING" | "DECLINED" | "UNCERTAIN") {
    setRsvpLoading(true);
    try {
      await updateRsvp.mutateAsync(status);
      toast({ title: "تم تحديث حالتك" });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    } finally {
      setRsvpLoading(false);
    }
  }

  async function handleAddParticipants() {
    if (!selectedToAdd.length) return;
    try {
      await addParticipants.mutateAsync(selectedToAdd);
      setSelectedToAdd([]);
      setParticipantPickerOpen(false);
      toast({ title: "تمت إضافة المشاركين وإرسال الدعوات" });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    }
  }

  async function handleRemoveParticipant(userId: number) {
    try {
      await removeParticipant.mutateAsync(userId);
      toast({ title: "تمت إزالة المشارك" });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    } finally {
      setRemovingParticipantId(null);
    }
  }

  async function handleTogglePermission(p: MeetingParticipant) {
    try {
      await togglePermission.mutateAsync({
        userId: p.userId,
        canEditAllAgenda: !p.canEditAllAgenda,
      });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    }
  }

  async function handleAddAgenda(values: AgendaItemForm) {
    try {
      await addAgenda.mutateAsync(values);
      agendaForm.reset();
      setIsAddAgendaOpen(false);
      toast({ title: "تمت إضافة المحور" });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    }
  }

  async function handleSaveAgendaEdit(values: AgendaItemForm & { recommendations?: string }) {
    if (!editingAgenda) return;
    try {
      await updateAgenda.mutateAsync({
        itemId: editingAgenda.id,
        title: values.title,
        description: values.description || null,
        recommendations: values.recommendations || null,
      });
      setEditingAgenda(null);
      toast({ title: "تم تحديث المحور" });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    }
  }

  async function handleToggleDone(item: MeetingAgendaItem) {
    try {
      await updateAgenda.mutateAsync({ itemId: item.id, isDone: !item.isDone });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    }
  }

  async function handleDeleteAgenda(itemId: number) {
    try {
      await deleteAgenda.mutateAsync(itemId);
      toast({ title: "تم حذف المحور" });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ" });
    } finally {
      setDeletingAgendaId(null);
    }
  }

  // ── Render ──

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-60">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!meeting) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-muted-foreground">
          الاجتماع غير موجود
        </div>
      </AppLayout>
    );
  }

  const isPast = new Date(meeting.scheduledAt) < new Date();

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Back + header */}
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/meetings")}
            className="shrink-0 mt-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold leading-tight">{meeting.title}</h2>
                {meeting.description && (
                  <p className="text-muted-foreground mt-1">{meeting.description}</p>
                )}
              </div>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 shrink-0"
                  onClick={() => setIsEditOpen(true)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  تعديل
                </Button>
              )}
            </div>

            {/* Meta */}
            <div className="flex flex-wrap gap-4 mt-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">{hijriDateFull(meeting.scheduledAt)}</p>
                  <p className="text-xs text-muted-foreground">{gregorianDate(meeting.scheduledAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-muted-foreground" />
                {timeStr(meeting.scheduledAt)}
              </div>
              {meeting.meetingLink && (
                <a
                  href={meeting.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Video className="w-4 h-4" />
                  رابط الاجتماع
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {isPast && (
                <Badge variant="outline" className="text-xs">اجتماع سابق</Badge>
              )}
            </div>
          </div>
        </div>

        {/* RSVP section — for participants who aren't the sole manager */}
        {myParticipant && !isPast && (
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold text-sm mb-3">تأكيد حضورك</h3>
            <div className="flex flex-wrap gap-2">
              {RSVP_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  disabled={rsvpLoading}
                  variant={myParticipant.rsvpStatus === opt.value ? "default" : "outline"}
                  className={`gap-1.5 text-xs ${
                    myParticipant.rsvpStatus === opt.value ? opt.color + " text-white" : ""
                  }`}
                  onClick={() => handleRsvp(opt.value)}
                >
                  {myParticipant.rsvpStatus === opt.value && (
                    <Check className="w-3 h-3" />
                  )}
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* RSVP summary */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="font-semibold text-sm mb-3">ملخص الحضور</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(["ATTENDING", "DECLINED", "UNCERTAIN", "PENDING"] as const).map((status) => (
              <button
                key={status}
                className={`rounded-lg border p-3 text-center transition-all hover:shadow-sm ${
                  activeRsvpSection === status ? "ring-2 ring-primary" : ""
                } ${RSVP_BADGE[status]}`}
                onClick={() =>
                  setActiveRsvpSection(
                    activeRsvpSection === status ? null : status,
                  )
                }
              >
                <p className="text-2xl font-bold">{rsvpCounts[status]}</p>
                <p className="text-xs mt-0.5">{RSVP_LABEL[status]}</p>
              </button>
            ))}
          </div>

          {/* Expanded list */}
          {activeRsvpSection && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-muted-foreground mb-2">
                {RSVP_LABEL[activeRsvpSection]}:
              </p>
              <div className="flex flex-wrap gap-2">
                {meeting.participants
                  .filter((p) => p.rsvpStatus === activeRsvpSection)
                  .map((p) => (
                    <Badge key={p.userId} variant="secondary" className="text-xs">
                      {p.userName ?? p.userEmail ?? `مستخدم ${p.userId}`}
                    </Badge>
                  ))}
                {meeting.participants.filter(
                  (p) => p.rsvpStatus === activeRsvpSection,
                ).length === 0 && (
                  <span className="text-xs text-muted-foreground">لا أحد</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Participants */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              المشاركون ({meeting.participants.length})
            </h3>
            {canManage && (
              <Popover
                open={participantPickerOpen}
                onOpenChange={setParticipantPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
                    <Plus className="w-3.5 h-3.5" />
                    إضافة مشارك
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="end">
                  <Command>
                    <CommandInput placeholder="ابحث..." />
                    <CommandList className="max-h-48">
                      <CommandEmpty>لا يوجد مستخدمون متاحون</CommandEmpty>
                      {managers.length > 0 && (
                        <CommandGroup heading="المديرون">
                          {managers.map((u) => (
                            <CommandItem
                              key={u.id}
                              onSelect={() => {
                                setSelectedToAdd((prev) =>
                                  prev.includes(u.id)
                                    ? prev.filter((id) => id !== u.id)
                                    : [...prev, u.id],
                                );
                              }}
                            >
                              <Check
                                className={`w-3.5 h-3.5 ml-2 ${
                                  selectedToAdd.includes(u.id)
                                    ? "opacity-100"
                                    : "opacity-0"
                                }`}
                              />
                              {u.name ?? u.email}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {technicians.length > 0 && (
                        <CommandGroup heading="الموظفون">
                          {technicians.map((u) => (
                            <CommandItem
                              key={u.id}
                              onSelect={() => {
                                setSelectedToAdd((prev) =>
                                  prev.includes(u.id)
                                    ? prev.filter((id) => id !== u.id)
                                    : [...prev, u.id],
                                );
                              }}
                            >
                              <Check
                                className={`w-3.5 h-3.5 ml-2 ${
                                  selectedToAdd.includes(u.id)
                                    ? "opacity-100"
                                    : "opacity-0"
                                }`}
                              />
                              {u.name ?? u.email}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                  {selectedToAdd.length > 0 && (
                    <div className="p-2 border-t">
                      <Button
                        size="sm"
                        className="w-full text-xs"
                        disabled={addParticipants.isPending}
                        onClick={handleAddParticipants}
                      >
                        {addParticipants.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" />
                        ) : null}
                        إضافة {selectedToAdd.length} مشارك
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="space-y-2">
            {meeting.participants.map((p) => (
              <div
                key={p.userId}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary">
                    {(p.userName ?? p.userEmail ?? "?").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.userName ?? p.userEmail ?? `مستخدم ${p.userId}`}
                    {meeting.createdById === p.userId && (
                      <span className="text-xs text-muted-foreground mr-1">(المنشئ)</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full border ${
                        RSVP_BADGE[p.rsvpStatus]
                      }`}
                    >
                      {RSVP_LABEL[p.rsvpStatus]}
                    </span>
                    {p.canEditAllAgenda && (
                      <span className="text-xs text-amber-600">✎ صلاحية تعديل المحاور</span>
                    )}
                  </div>
                </div>

                {canManage && p.userId !== currentUserId && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      title={p.canEditAllAgenda ? "سحب صلاحية التعديل" : "منح صلاحية تعديل المحاور"}
                      onClick={() => handleTogglePermission(p)}
                    >
                      <Pen className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setRemovingParticipantId(p.userId)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Agenda items */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">
              محاور الاجتماع ({meeting.agendaItems.length})
            </h3>
            {(canManage || !!myParticipant) && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs h-8"
                onClick={() => {
                  agendaForm.reset();
                  setIsAddAgendaOpen(true);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                إضافة محور
              </Button>
            )}
          </div>

          {meeting.agendaItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              لا توجد محاور مسجلة بعد
            </div>
          ) : (
            <div className="space-y-3">
              {meeting.agendaItems.map((item, idx) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 transition-all ${
                    item.isDone
                      ? "opacity-60 bg-muted/30 border-dashed"
                      : "bg-background hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Done toggle */}
                    <button
                      className={`shrink-0 mt-0.5 transition-colors ${
                        canToggleDone(item)
                          ? "text-primary hover:text-primary/70"
                          : "text-muted-foreground cursor-default"
                      }`}
                      onClick={() => canToggleDone(item) && handleToggleDone(item)}
                      disabled={!canToggleDone(item)}
                    >
                      {item.isDone ? (
                        <CheckSquare className="w-5 h-5" />
                      ) : (
                        <Square className="w-5 h-5" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-mono">
                          {idx + 1}.
                        </span>
                        <p
                          className={`font-medium text-sm ${
                            item.isDone ? "line-through" : ""
                          }`}
                        >
                          {item.title}
                        </p>
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 mr-5">
                          {item.description}
                        </p>
                      )}
                      {item.creatorName && (
                        <p className="text-xs text-muted-foreground/60 mt-1 mr-5">
                          بقلم: {item.creatorName}
                        </p>
                      )}

                      {/* Recommendations box */}
                      {item.recommendations && (
                        <div className="mt-2 mr-5 rounded-lg bg-emerald-50 border border-emerald-200 p-2.5">
                          <p className="text-xs font-semibold text-emerald-700 mb-1">
                            التوصيات:
                          </p>
                          <p className="text-xs text-emerald-800 whitespace-pre-wrap">
                            {item.recommendations}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {canEditAgendaItem(item) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditingAgenda(item);
                            agendaEditForm.reset({
                              title: item.title,
                              description: item.description ?? "",
                              recommendations: item.recommendations ?? "",
                            });
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {canDeleteAgendaItem(item) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeletingAgendaId(item.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit meeting dialog ── */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل الاجتماع</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(handleUpdateMeeting)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>العنوان</Label>
              <Input {...editForm.register("title")} />
            </div>
            <div className="space-y-1.5">
              <Label>الوصف</Label>
              <Textarea {...editForm.register("description")} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>رابط الاجتماع</Label>
              <Input {...editForm.register("meetingLink")} dir="ltr" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>التاريخ</Label>
                <Input type="date" {...editForm.register("scheduledDate")} dir="ltr" />
                {editForm.watch("scheduledDate") && (
                  <p className="text-xs text-primary">
                    {hijriDateFull(editForm.watch("scheduledDate"))}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>الوقت</Label>
                <Input type="time" {...editForm.register("scheduledTime")} dir="ltr" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>التذكير</Label>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => editForm.setValue("reminderMinutes", opt.value)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-all ${
                      editForm.watch("reminderMinutes") === opt.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border"
                    }`}
                  >
                    قبل {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={updateMeeting.isPending}>
                {updateMeeting.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin ml-1" />
                )}
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add agenda item dialog ── */}
      <Dialog open={isAddAgendaOpen} onOpenChange={setIsAddAgendaOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة محور جديد</DialogTitle>
          </DialogHeader>
          <form onSubmit={agendaForm.handleSubmit(handleAddAgenda)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                العنوان <span className="text-destructive">*</span>
              </Label>
              <Input {...agendaForm.register("title")} placeholder="عنوان المحور" />
              {agendaForm.formState.errors.title && (
                <p className="text-xs text-destructive">
                  {agendaForm.formState.errors.title.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>الوصف (اختياري)</Label>
              <Textarea {...agendaForm.register("description")} rows={2} />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddAgendaOpen(false)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={addAgenda.isPending}>
                {addAgenda.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin ml-1" />
                )}
                إضافة
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit agenda item dialog ── */}
      <Dialog open={!!editingAgenda} onOpenChange={(open) => !open && setEditingAgenda(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل المحور</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={agendaEditForm.handleSubmit(handleSaveAgendaEdit)}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label>العنوان</Label>
              <Input {...agendaEditForm.register("title")} />
            </div>
            <div className="space-y-1.5">
              <Label>الوصف</Label>
              <Textarea {...agendaEditForm.register("description")} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>التوصيات</Label>
              <Textarea
                {...agendaEditForm.register("recommendations")}
                rows={3}
                placeholder="توصيات النقاش..."
                className="border-emerald-200 focus:border-emerald-400"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingAgenda(null)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={updateAgenda.isPending}>
                {updateAgenda.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin ml-1" />
                )}
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete agenda item confirm ── */}
      <AlertDialog
        open={deletingAgendaId !== null}
        onOpenChange={(open) => !open && setDeletingAgendaId(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المحور</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا المحور؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() =>
                deletingAgendaId && handleDeleteAgenda(deletingAgendaId)
              }
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Remove participant confirm ── */}
      <AlertDialog
        open={removingParticipantId !== null}
        onOpenChange={(open) => !open && setRemovingParticipantId(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>إزالة المشارك</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من إزالة هذا المشارك من الاجتماع؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() =>
                removingParticipantId &&
                handleRemoveParticipant(removingParticipantId)
              }
            >
              إزالة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
