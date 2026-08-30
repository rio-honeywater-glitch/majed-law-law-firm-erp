async function fingerprintPayload(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function storageKey(
  tenantId: number,
  userId: number,
  caseId: number,
  payload: string,
): Promise<string> {
  return `client-report-send-attempt:${tenantId}:${userId}:${caseId}:${await fingerprintPayload(payload)}`;
}

export async function getOrCreateReportSendAttemptId(
  tenantId: number,
  userId: number,
  caseId: number,
  payload: string,
): Promise<string> {
  const key = await storageKey(tenantId, userId, caseId, payload);
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const attemptId = crypto.randomUUID();
    localStorage.setItem(key, attemptId);
    return attemptId;
  } catch {
    return crypto.randomUUID();
  }
}

export async function clearReportSendAttemptId(
  tenantId: number,
  userId: number,
  caseId: number,
  payload: string,
  attemptId: string,
): Promise<void> {
  const key = await storageKey(tenantId, userId, caseId, payload);
  try {
    if (localStorage.getItem(key) === attemptId) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in private browsing; the successful request
    // still completed, so there is nothing else to clean up.
  }
}