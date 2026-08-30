/**
 * Meetings API — hand-written hooks (not orval-generated).
 * Uses the same customFetch utility as generated hooks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RsvpStatus = "ATTENDING" | "DECLINED" | "UNCERTAIN" | "PENDING";

export interface MeetingListItem {
  id: number;
  tenantId: number;
  title: string;
  description: string | null;
  meetingLink: string | null;
  scheduledAt: string;
  reminderMinutes: number;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string | null;
  participantCount: number;
  myRsvp: RsvpStatus | null;
}

export interface MeetingParticipant {
  id: number;
  meetingId: number;
  userId: number;
  rsvpStatus: RsvpStatus;
  reminderSent: boolean;
  canEditAllAgenda: boolean;
  addedAt: string;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
}

export interface MeetingAgendaItem {
  id: number;
  meetingId: number;
  createdById: number;
  title: string;
  description: string | null;
  recommendations: string | null;
  isDone: boolean;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  creatorName: string | null;
}

export interface MeetingDetail extends MeetingListItem {
  participants: MeetingParticipant[];
  agendaItems: MeetingAgendaItem[];
}

export interface CreateMeetingInput {
  title: string;
  description?: string;
  meetingLink?: string;
  scheduledAt: string;
  reminderMinutes?: number;
  participantIds?: number[];
  agendaItems?: { title: string; description?: string }[];
}

export interface UpdateMeetingInput {
  title?: string;
  description?: string | null;
  meetingLink?: string | null;
  scheduledAt?: string;
  reminderMinutes?: number;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const getMeetingsQueryKey = () => ["/api/meetings"] as const;
export const getMeetingQueryKey = (id: number) => ["/api/meetings", id] as const;

// ─── List meetings ────────────────────────────────────────────────────────────

export const listMeetings = (): Promise<MeetingListItem[]> =>
  customFetch<MeetingListItem[]>("/api/meetings");

export function useListMeetings() {
  return useQuery({
    queryKey: getMeetingsQueryKey(),
    queryFn: () => listMeetings(),
    refetchInterval: 60_000,
  });
}

// ─── Get meeting detail ───────────────────────────────────────────────────────

export const getMeeting = (id: number): Promise<MeetingDetail> =>
  customFetch<MeetingDetail>(`/api/meetings/${id}`);

export function useGetMeeting(id: number) {
  return useQuery({
    queryKey: getMeetingQueryKey(id),
    queryFn: () => getMeeting(id),
    enabled: !!id,
  });
}

// ─── Create meeting ───────────────────────────────────────────────────────────

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMeetingInput) =>
      customFetch<MeetingListItem>("/api/meetings", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getMeetingsQueryKey() }),
  });
}

// ─── Update meeting ───────────────────────────────────────────────────────────

export function useUpdateMeeting(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateMeetingInput) =>
      customFetch<MeetingListItem>(`/api/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getMeetingsQueryKey() });
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(id) });
    },
  });
}

// ─── Delete meeting ───────────────────────────────────────────────────────────

export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<{ ok: boolean }>(`/api/meetings/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getMeetingsQueryKey() }),
  });
}

// ─── Participants: add ────────────────────────────────────────────────────────

export function useAddParticipants(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: number[]) =>
      customFetch<MeetingParticipant[]>(`/api/meetings/${meetingId}/participants`, {
        method: "POST",
        body: JSON.stringify({ userIds }),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(meetingId) }),
  });
}

// ─── Participants: remove ─────────────────────────────────────────────────────

export function useRemoveParticipant(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) =>
      customFetch<{ ok: boolean }>(
        `/api/meetings/${meetingId}/participants/${userId}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(meetingId) }),
  });
}

// ─── RSVP ─────────────────────────────────────────────────────────────────────

export function useUpdateRsvp(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: "ATTENDING" | "DECLINED" | "UNCERTAIN") =>
      customFetch<MeetingParticipant>(`/api/meetings/${meetingId}/rsvp`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(meetingId) });
      qc.invalidateQueries({ queryKey: getMeetingsQueryKey() });
    },
  });
}

// ─── Permission toggle ────────────────────────────────────────────────────────

export function useToggleEditPermission(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      canEditAllAgenda,
    }: {
      userId: number;
      canEditAllAgenda: boolean;
    }) =>
      customFetch<MeetingParticipant>(
        `/api/meetings/${meetingId}/participants/${userId}/permission`,
        {
          method: "PATCH",
          body: JSON.stringify({ canEditAllAgenda }),
        },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(meetingId) }),
  });
}

// ─── Agenda: add ──────────────────────────────────────────────────────────────

export function useAddAgendaItem(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; description?: string }) =>
      customFetch<MeetingAgendaItem>(`/api/meetings/${meetingId}/agenda`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(meetingId) }),
  });
}

// ─── Agenda: update ───────────────────────────────────────────────────────────

export function useUpdateAgendaItem(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      ...data
    }: {
      itemId: number;
      title?: string;
      description?: string | null;
      recommendations?: string | null;
      isDone?: boolean;
    }) =>
      customFetch<MeetingAgendaItem>(
        `/api/meetings/${meetingId}/agenda/${itemId}`,
        {
          method: "PATCH",
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(meetingId) }),
  });
}

// ─── Agenda: delete ───────────────────────────────────────────────────────────

export function useDeleteAgendaItem(meetingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) =>
      customFetch<{ ok: boolean }>(
        `/api/meetings/${meetingId}/agenda/${itemId}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: getMeetingQueryKey(meetingId) }),
  });
}
