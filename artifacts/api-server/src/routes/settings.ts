import { Router, type IRouter, Request, Response } from "express";
import { clientsTable, db, systemSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireSystemManager } from "../middlewares/auth";
import { scoped, tenantStamp } from "../lib/tenant";
import { logger } from "../lib/logger";
import { buildTestEmailHtml, isMailerConfigured, isValidEmail, sendMail } from "../lib/mailer";
import {
  getEnvironmentSenderEmail,
  OFFICIAL_SENDER_EMAIL_KEY,
  resolveOfficialSenderEmail,
} from "../lib/mail-settings";
import { SendOfficialSenderTestEmailBody } from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth);

const SETTING_DEFAULTS: Record<string, boolean> = {
  TASKS_MODULE_VISIBLE: true,
};

const NUMERIC_SETTING_DEFAULTS: Record<string, number> = {
  TRANSFER_ORDER_ALERT_DAYS: 7,
  EXECUTION_REMINDER_DAYS: 7,
};

const TEXT_SETTING_KEYS = new Set([OFFICIAL_SENDER_EMAIL_KEY]);

router.post("/test-email", requireSystemManager, async (req: Request, res: Response): Promise<void> => {
  const parsed = SendOfficialSenderTestEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "يرجى إدخال بريد إلكتروني صالح لاستلام الرسالة التجريبية." });
    return;
  }

  if (!isMailerConfigured()) {
    res.status(503).json({
      error: "خدمة البريد غير مهيأة. يرجى إضافة مفتاح Resend أولاً.",
    });
    return;
  }

  try {
    const recipient = parsed.data.to.trim().toLowerCase();
    const [matchingClient] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(scoped(
        req,
        clientsTable.tenantId,
        sql`lower(trim(${clientsTable.email})) = ${recipient}`,
      ))
      .limit(1);
    if (matchingClient) {
      res.status(409).json({
        error: "لا يمكن إرسال رسالة الاختبار إلى بريد مسجل لأحد العملاء. استخدم بريداً داخلياً تملكه.",
      });
      return;
    }

    const senderEmail = await resolveOfficialSenderEmail(tenantStamp(req));
    if (!senderEmail) {
      res.status(400).json({
        error: "لم يتم تحديد البريد الرسمي للمرسل. احفظه من إعدادات البريد أولاً.",
      });
      return;
    }

    await sendMail({
      from: senderEmail,
      to: recipient,
      subject: "رسالة اختبار البريد الرسمي - مكتب المحامي ماجد بن سلطان السبيعي",
      html: buildTestEmailHtml(),
    });

    res.json({
      success: true,
      message: "تم إرسال رسالة الاختبار بنجاح.",
      recipient,
    });
  } catch (err) {
    req.log.error({ err }, "official sender test email failed");
    const resendName = (err as { resendName?: string })?.resendName;
    if (resendName === "missing_api_key") {
      res.status(503).json({
        error: "مفتاح Resend غير مهيأ. يرجى إضافته قبل إرسال الرسالة التجريبية.",
      });
      return;
    }
    if (resendName === "invalid_api_key" || resendName === "restricted_api_key") {
      res.status(502).json({
        error: "مفتاح Resend غير صالح أو مقيد. يرجى التحقق من إعداد الخدمة.",
      });
      return;
    }
    if (resendName === "validation_error" || resendName === "invalid_from_address" || resendName === "missing_from_address") {
      res.status(502).json({
        error: "رفض Resend الرسالة. تحقق من عنوان المرسل وأن نطاقه موثق في Resend.",
      });
      return;
    }
    if (resendName === "rate_limit_exceeded" || resendName === "daily_quota_exceeded") {
      res.status(502).json({
        error: "تم تجاوز حد الإرسال في Resend. حاول مرة أخرى لاحقاً.",
      });
      return;
    }
    res.status(502).json({
      error: "تعذر إرسال رسالة الاختبار عبر Resend. تحقق من إعداد النطاق ثم حاول مرة أخرى.",
    });
  }
});

router.get("/:key", async (req: Request, res: Response) => {
  try {
    const key = req.params["key"] as string;
    if (TEXT_SETTING_KEYS.has(key) && req.auth!.role !== "SYSTEM_MANAGER") {
      res.status(403).json({ error: "هذا الإعداد متاح لمدير النظام فقط." });
      return;
    }
    const [row] = await db.select().from(systemSettingsTable)
      .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, key))).limit(1);
    if (row) {
      if (key in NUMERIC_SETTING_DEFAULTS) {
        res.json({ key: row.key, numericValue: row.numericValue ?? NUMERIC_SETTING_DEFAULTS[key] });
      } else if (TEXT_SETTING_KEYS.has(key)) {
        res.json({ key: row.key, textValue: row.textValue ?? getEnvironmentSenderEmail() ?? "" });
      } else {
        res.json({ key: row.key, value: row.value });
      }
      return;
    }
    if (key in NUMERIC_SETTING_DEFAULTS) {
      res.json({ key, numericValue: NUMERIC_SETTING_DEFAULTS[key] });
      return;
    }
    if (key in SETTING_DEFAULTS) {
      res.json({ key, value: SETTING_DEFAULTS[key] });
      return;
    }
    if (TEXT_SETTING_KEYS.has(key)) {
      res.json({ key, textValue: getEnvironmentSenderEmail() ?? "" });
      return;
    }
    res.status(404).json({ error: "Setting not found" });
  } catch (err) {
    logger.error({ err }, "get setting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:key", requireSystemManager, async (req: Request, res: Response) => {
  try {
    const key = req.params["key"] as string;
    const tenantId = tenantStamp(req);

    if (TEXT_SETTING_KEYS.has(key)) {
      const rawTextValue = (req.body as { textValue?: unknown }).textValue;
      if (typeof rawTextValue !== "string") {
        res.status(400).json({ error: "يجب إدخال عنوان البريد الرسمي." });
        return;
      }
      const textValue = rawTextValue.trim().toLowerCase();
      if (textValue.length > 320 || (textValue.length > 0 && !isValidEmail(textValue))) {
        res.status(400).json({ error: "عنوان البريد الإلكتروني غير صالح." });
        return;
      }

      const [existing] = await db.select().from(systemSettingsTable)
        .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, key))).limit(1);

      let updated;
      if (existing) {
        [updated] = await db.update(systemSettingsTable)
          .set({ textValue: textValue || null })
          .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, key)))
          .returning();
      } else {
        [updated] = await db.insert(systemSettingsTable)
          .values({ tenantId, key, value: true, textValue: textValue || null })
          .returning();
      }
      res.json({ key: updated.key, textValue: updated.textValue ?? getEnvironmentSenderEmail() ?? "" });
      return;
    }

    // Handle numeric settings
    if (key in NUMERIC_SETTING_DEFAULTS) {
      const { numericValue } = req.body as { numericValue: number };
      if (typeof numericValue !== "number" || !Number.isInteger(numericValue) || numericValue < 1) {
        res.status(400).json({ error: "numericValue must be a positive integer" });
        return;
      }
      const [existing] = await db.select().from(systemSettingsTable)
        .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, key))).limit(1);

      let updated;
      if (existing) {
        [updated] = await db.update(systemSettingsTable).set({ numericValue })
          .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, key))).returning();
      } else {
        [updated] = await db.insert(systemSettingsTable).values({ tenantId, key, value: true, numericValue }).returning();
      }
      res.json({ key: updated.key, numericValue: updated.numericValue ?? NUMERIC_SETTING_DEFAULTS[key] });
      return;
    }

    // Handle boolean settings
    if (!(key in SETTING_DEFAULTS)) {
      res.status(404).json({ error: "Setting not found" });
      return;
    }
    const { value } = req.body as { value: boolean };
    if (typeof value !== "boolean") {
      res.status(400).json({ error: "value must be a boolean" });
      return;
    }
    const [existing] = await db.select().from(systemSettingsTable)
      .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, key))).limit(1);

    let updated;
    if (existing) {
      [updated] = await db.update(systemSettingsTable).set({ value })
        .where(scoped(req, systemSettingsTable.tenantId, eq(systemSettingsTable.key, key))).returning();
    } else {
      [updated] = await db.insert(systemSettingsTable).values({ tenantId, key, value }).returning();
    }
    res.json({ key: updated.key, value: updated.value });
  } catch (err) {
    logger.error({ err }, "update setting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
