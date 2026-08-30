import { useState } from "react";
import { useLocation } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListMeetings,
  useCreateMeeting,
  useDeleteMeeting,
  useListUsers,
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
  DialogTrigger,
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
  Plus,
  Loader2,
  CalendarClock,
  Trash2,
  ExternalLink,
  Check,
  Users,
  ChevronDown,
  Clock,
  Video,
  ListChecks,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hijriDate(iso: string) {
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

function hijriTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

const RSVP_LABELS: Record<string, string> = {
  ATTENDING: "سيحضر",
  DECLINED: "معتذر",
  UNCERTAIN: "غير متأكد",
  PENDING: "لم يرد",
};

const RSVP_COLORS: Record<string, string> = {
  ATTENDING: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
  DECLINED: "bg-destructive/10 text-destructive border-destructive/20",
  UNCERTAIN: "bg-amber-500/10 text-amber-600 border-amber-200",
  PENDING: "bg-muted text-muted-foreground border-border",
};

// ─── Form schema ──────────────────────────────────────────────────────────────

const meetingSchema = z.object({
  title: z.string().min(1, "عنوان الاجتماع مطلوب"),
  description: z.string().optional(),
  meetingLink: z.string().url("رابط غير صحيح").optional().or(z.literal("")),
  scheduledDate: z.string().min(1, "التاريخ مطلوب"),
  scheduledTime: z.string().min(1, "الوقت مطلوب"),
  reminderMinutes: z.coerce.number().min(1).max(10080).default(15),
  agendaItems: z.array(
    z.object({
      title: z.string().min(1, "عنوان المحور مطلوب"),
      description: z.string().optional(),
    }),
  ),
});

type MeetingFormValues = z.infer<typeof meetingSchema>;

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

export default function Meetings() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);

  const { data: meetings, isLoading } = useListMeetings();
  const { data: users } = useListUsers({});
  const createMeeting = useCreateMeeting();
  const deleteMeeting = useDeleteMeeting();

  const form = useForm<MeetingFormValues>({
    resolver: zodResolver(meetingSchema),
    defaultValues: {
      title: "",
      description: "",
      meetingLink: "",
      scheduledDate: "",
      scheduledTime: "09:00",
      reminderMinutes: 15,
      agendaItems: [],
    },
  });

  const { fields: agendaFields, append: appendAgenda, remove: removeAgenda } =
    useFieldArray({ control: form.control, name: "agendaItems" });

  const now = new Date();
  const upcoming = (meetings ?? []).filter(
    (m) => new Date(m.scheduledAt) >= now,
  );
  const past = (meetings ?? []).filter((m) => new Date(m.scheduledAt) < now);

  // Group users by role for participant picker
  const managers = (users ?? []).filter((u) => u.role === "SYSTEM_MANAGER");
  const technicians = (users ?? []).filter((u) => u.role === "TECHNICIAN");

  function toggleParticipant(uid: number) {
    setSelectedParticipants((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  }

  function selectAll(ids: number[]) {
    setSelectedParticipants((prev) => {
      const set = new Set(prev);
      ids.forEach((id) => set.add(id));
      return Array.from(set);
    });
  }

  function resetForm() {
    form.reset();
    setSelectedParticipants([]);
  }

  async function onSubmit(values: MeetingFormValues) {
    try {
      const scheduledAt = new Date(
        `${values.scheduledDate}T${values.scheduledTime}`,
      ).toISOString();

      await createMeeting.mutateAsync({
        title: values.title,
        description: values.description || undefined,
        meetingLink: values.meetingLink || undefined,
        scheduledAt,
        reminderMinutes: values.reminderMinutes,
        participantIds: selectedParticipants,
        agendaItems: values.agendaItems.filter((a) => a.title.trim()),
      });

      toast({ title: "تم إنشاء الاجتماع وإرسال الدعوات بنجاح" });
      setIsDialogOpen(false);
      resetForm();
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ أثناء إنشاء الاجتماع" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMeeting.mutateAsync(id);
      toast({ title: "تم حذف الاجتماع" });
    } catch {
      toast({ variant: "destructive", title: "حدث خطأ أثناء الحذف" });
    } finally {
      setDeletingId(null);
    }
  }

  const selectedUsers = (users ?? []).filter((u) =>
    selectedParticipants.includes(u.id),
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">الاجتماعات الدورية</h2>
            <p className="text-muted-foreground mt-1">
              إدارة اجتماعات الفريق وجداول الأعمال
            </p>
          </div>

          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2 shrink-0">
                <Plus className="w-4 h-4" />
                اجتماع جديد
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
              <DialogHeader>
                <DialogTitle>إنشاء اجتماع جديد</DialogTitle>
              </DialogHeader>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                {/* Title */}
                <div className="space-y-1.5">
                  <Label>
                    العنوان <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    {...form.register("title")}
                    placeholder="عنوان الاجتماع"
                  />
                  {form.formState.errors.title && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.title.message}
                    </p>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <Label>الوصف (اختياري)</Label>
                  <Textarea
                    {...form.register("description")}
                    placeholder="وصف مختصر للاجتماع"
                    rows={2}
                  />
                </div>

                {/* Meeting link */}
                <div className="space-y-1.5">
                  <Label>رابط الاجتماع (اختياري)</Label>
                  <Input
                    {...form.register("meetingLink")}
                    placeholder="https://meet.google.com/..."
                    dir="ltr"
                  />
                  {form.formState.errors.meetingLink && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.meetingLink.message}
                    </p>
                  )}
                </div>

                {/* Date + Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>
                      التاريخ <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="date"
                      {...form.register("scheduledDate")}
                      dir="ltr"
                    />
                    {form.formState.errors.scheduledDate && (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.scheduledDate.message}
                      </p>
                    )}
                    {/* Hijri preview */}
                    {form.watch("scheduledDate") && (
                      <p className="text-xs text-primary font-medium">
                        {hijriDate(form.watch("scheduledDate"))}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>
                      الوقت <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="time"
                      {...form.register("scheduledTime")}
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Reminder */}
                <div className="space-y-1.5">
                  <Label>موعد التذكير</Label>
                  <div className="flex flex-wrap gap-2">
                    {REMINDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          form.setValue("reminderMinutes", opt.value)
                        }
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          form.watch("reminderMinutes") === opt.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        قبل {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Participants */}
                <div className="space-y-1.5">
                  <Label>المشاركون</Label>
                  <Popover
                    open={participantPickerOpen}
                    onOpenChange={setParticipantPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between"
                      >
                        <span className="flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          {selectedParticipants.length
                            ? `${selectedParticipants.length} مشارك محدد`
                            : "اختر المشاركين"}
                        </span>
                        <ChevronDown className="w-4 h-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="ابحث بالاسم..." />
                        <CommandList className="max-h-60">
                          <CommandEmpty>لا توجد نتائج</CommandEmpty>
                          {managers.length > 0 && (
                            <CommandGroup heading="المديرون">
                              <CommandItem
                                onSelect={() => selectAll(managers.map((u) => u.id))}
                                className="text-xs text-primary cursor-pointer"
                              >
                                تحديد الكل
                              </CommandItem>
                              {managers.map((u) => (
                                <CommandItem
                                  key={u.id}
                                  onSelect={() => toggleParticipant(u.id)}
                                >
                                  <Check
                                    className={`w-3.5 h-3.5 ml-2 ${
                                      selectedParticipants.includes(u.id)
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
                              <CommandItem
                                onSelect={() =>
                                  selectAll(technicians.map((u) => u.id))
                                }
                                className="text-xs text-primary cursor-pointer"
                              >
                                تحديد الكل
                              </CommandItem>
                              {technicians.map((u) => (
                                <CommandItem
                                  key={u.id}
                                  onSelect={() => toggleParticipant(u.id)}
                                >
                                  <Check
                                    className={`w-3.5 h-3.5 ml-2 ${
                                      selectedParticipants.includes(u.id)
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
                    </PopoverContent>
                  </Popover>

                  {/* Selected chips */}
                  {selectedUsers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {selectedUsers.map((u) => (
                        <Badge
                          key={u.id}
                          variant="secondary"
                          className="gap-1 pl-1"
                        >
                          {u.name ?? u.email}
                          <button
                            type="button"
                            onClick={() => toggleParticipant(u.id)}
                            className="hover:text-destructive transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Agenda items */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>محاور الاجتماع (اختياري)</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs h-7"
                      onClick={() => appendAgenda({ title: "", description: "" })}
                    >
                      <Plus className="w-3 h-3" />
                      إضافة محور
                    </Button>
                  </div>

                  {agendaFields.map((field, idx) => (
                    <div
                      key={field.id}
                      className="flex gap-2 p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="flex-1 space-y-2">
                        <Input
                          {...form.register(`agendaItems.${idx}.title`)}
                          placeholder={`محور ${idx + 1}`}
                          className="h-8 text-sm"
                        />
                        <Input
                          {...form.register(`agendaItems.${idx}.description`)}
                          placeholder="وصف اختياري"
                          className="h-8 text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removeAgenda(idx)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                  >
                    إلغاء
                  </Button>
                  <Button type="submit" disabled={createMeeting.isPending}>
                    {createMeeting.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin ml-2" />
                    ) : null}
                    إنشاء الاجتماع
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Upcoming meetings */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h3 className="font-semibold text-base">
                  الاجتماعات القادمة
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {upcoming.length}
                </Badge>
              </div>

              {upcoming.length === 0 ? (
                <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
                  <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p>لا توجد اجتماعات قادمة</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {upcoming.map((m) => (
                    <MeetingCard
                      key={m.id}
                      meeting={m}
                      isUpcoming
                      currentUserId={user?.id ?? 0}
                      onOpen={() => navigate(`/meetings/${m.id}`)}
                      onDelete={() => setDeletingId(m.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Past meetings */}
            {past.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
                  <h3 className="font-semibold text-base text-muted-foreground">
                    اجتماعات سابقة
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    {past.length}
                  </Badge>
                </div>
                <div className="grid gap-3">
                  {[...past].reverse().map((m) => (
                    <MeetingCard
                      key={m.id}
                      meeting={m}
                      isUpcoming={false}
                      currentUserId={user?.id ?? 0}
                      onOpen={() => navigate(`/meetings/${m.id}`)}
                      onDelete={() => setDeletingId(m.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Delete confirm */}
      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الاجتماع</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا الاجتماع؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deletingId && handleDelete(deletingId)}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

// ─── Meeting card ─────────────────────────────────────────────────────────────

function MeetingCard({
  meeting,
  isUpcoming,
  currentUserId,
  onOpen,
  onDelete,
}: {
  meeting: {
    id: number;
    title: string;
    description: string | null;
    scheduledAt: string;
    meetingLink: string | null;
    participantCount: number;
    creatorName: string | null;
    createdById: number;
    myRsvp: string | null;
  };
  isUpcoming: boolean;
  currentUserId: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { user } = useAuth();
  const isManager = user?.role === "SYSTEM_MANAGER";
  const isCreator = meeting.createdById === currentUserId;

  return (
    <div
      className={`rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow cursor-pointer group ${
        isUpcoming ? "border-emerald-200/60 dark:border-emerald-900/30" : "opacity-80"
      }`}
      onClick={onOpen}
    >
      <div className="p-4 flex gap-4">
        {/* Date column */}
        <div
          className={`shrink-0 w-16 rounded-lg flex flex-col items-center justify-center py-3 text-center ${
            isUpcoming
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <span className="text-xs font-medium leading-tight">
            {hijriDate(meeting.scheduledAt).split(" ").slice(1, 3).join("\n")}
          </span>
          <span className="text-base font-bold mt-1">
            {new Intl.DateTimeFormat("ar-SA-u-ca-islamic", { day: "numeric" }).format(
              new Date(meeting.scheduledAt),
            )}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-base leading-snug">{meeting.title}</h4>
            <div className="flex items-center gap-1 shrink-0">
              {meeting.myRsvp && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    RSVP_COLORS[meeting.myRsvp] ?? RSVP_COLORS.PENDING
                  }`}
                >
                  {RSVP_LABELS[meeting.myRsvp]}
                </span>
              )}
              {(isManager || isCreator) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>

          {meeting.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
              {meeting.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {hijriTime(meeting.scheduledAt)}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              {meeting.participantCount} مشارك
            </span>
            {meeting.meetingLink && (
              <a
                href={meeting.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <Video className="w-3.5 h-3.5" />
                رابط الاجتماع
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
            {meeting.creatorName && (
              <span className="text-xs text-muted-foreground">
                أنشأه: {meeting.creatorName}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
