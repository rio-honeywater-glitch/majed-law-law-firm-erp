import { hearingsTable } from "@workspace/db";

export const HEARING_STATUSES = ["UPCOMING", "ENDED", "CANCELLED"] as const;
export type HearingStatus = (typeof HEARING_STATUSES)[number];

export function isHearingStatus(value: unknown): value is HearingStatus {
  return typeof value === "string" &&
    HEARING_STATUSES.includes(value as HearingStatus);
}

export function serializeHearing(h: typeof hearingsTable.$inferSelect) {
  return {
    ...h,
    utcDate: h.utcDate.toISOString(),
    createdAt: h.createdAt.toISOString(),
    effectiveStatus: h.status ?? (h.utcDate < new Date() ? "ENDED" : "UPCOMING"),
  };
}