import { db, systemSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const OFFICIAL_SENDER_EMAIL_KEY = "OFFICIAL_SENDER_EMAIL";

export function getEnvironmentSenderEmail(): string | null {
  const sender = process.env.RESEND_FROM?.trim().toLowerCase();
  return sender || null;
}

export async function resolveOfficialSenderEmail(tenantId: number): Promise<string | null> {
  const [setting] = await db
    .select({ textValue: systemSettingsTable.textValue })
    .from(systemSettingsTable)
    .where(and(
      eq(systemSettingsTable.tenantId, tenantId),
      eq(systemSettingsTable.key, OFFICIAL_SENDER_EMAIL_KEY),
    ))
    .limit(1);

  const configured = setting?.textValue?.trim().toLowerCase();
  return configured || getEnvironmentSenderEmail();
}