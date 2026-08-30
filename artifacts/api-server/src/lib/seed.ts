import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  clientsTable,
  casesTable,
  contractsTable,
  pleadingsTable,
  hearingsTable,
  executionsTable,
  notificationsTable,
  activityLogTable,
} from "@workspace/db";
import bcrypt from "bcryptjs";
import { logger } from "./logger";

export async function seedIfEmpty() {
  try {
    const existingUsers = await db.select().from(usersTable).limit(1);
    if (existingUsers.length > 0) {
      logger.info("Database already seeded, skipping");
      return;
    }

    logger.info("Seeding database...");

    // Create the firm tenant. Single fixed firm — Majed Sultan Al-Subaie Law Firm.
    const [tenant] = await db.insert(tenantsTable).values({
      name: "مكتب المحامي ماجد بن سلطان السبيعي",
      logoUrl: "/legacy-firm-logo.png",
      primaryColor: "#C9A227",
      secondaryColor: "#0A0A0A",
      status: "ACTIVE",
    }).returning();
    const tenantId = tenant.id;

    // Seed users
    const passwordHash = await bcrypt.hash("admin123", 10);
    const techHash = await bcrypt.hash("tech123", 10);

    await db.insert(usersTable).values([
      { tenantId, email: "manager@lawfirm.sa", passwordHash, name: "ماجد بن سلطان السبيعي", role: "SYSTEM_MANAGER" },
      { tenantId, email: "tech@lawfirm.sa", passwordHash: techHash, name: "محمد العتيبي", role: "TECHNICIAN" },
    ]).returning();

    // Seed clients
    const [client1, client2, client3] = await db.insert(clientsTable).values([
      { tenantId, name: "شركة الخليج للتطوير", email: "gulf@company.sa", phone: "0501234567", nationalId: "1234567890" },
      { tenantId, name: "أحمد بن محمد الرشيد", email: "ahmed@mail.com", phone: "0557891234", nationalId: "9876543210" },
      { tenantId, name: "مؤسسة النور التجارية", email: "noor@business.sa", phone: "0563214567", nationalId: "4567891230" },
    ]).returning();

    // Seed contracts
    await db.insert(contractsTable).values([
      { tenantId, clientId: client1.id, serviceType: "FULL_REP", hijriDate: "1446/08/01", preamble: "تمثيل كامل في قضية تجارية", fees: "15000", isSigned: true },
      { tenantId, clientId: client2.id, serviceType: "CONSULTATION", hijriDate: "1446/08/10", preamble: "استشارة قانونية شاملة", fees: "3000", isSigned: true },
      { tenantId, clientId: client3.id, serviceType: "CONTRACT_DRAFTING", hijriDate: "1446/08/15", preamble: "صياغة عقد شراكة تجارية", fees: "8000", isSigned: false },
    ]);

    // Seed cases
    const [case1, case2, case3] = await db.insert(casesTable).values([
      { tenantId, clientId: client1.id, jurisdiction: "المحكمة التجارية بالرياض", opponentName: "شركة المستقبل للاستثمار", subject: "نزاع تجاري على عقد توريد", caseNumber: "1446/TC/001", status: "UNDER_REVIEW" },
      { tenantId, clientId: client2.id, jurisdiction: "محكمة الاستئناف بالرياض", opponentName: "محمد خالد الغامدي", subject: "قضية عقارية - استحقاق ملكية", caseNumber: "1446/AC/045", status: "EXECUTION" },
      { tenantId, clientId: client3.id, jurisdiction: "المحكمة العامة بجدة", opponentName: "شركة البناء والتعمير", subject: "مطالبة مالية - مقاولات", caseNumber: "1446/GC/112", status: "CLOSED" },
    ]).returning();

    // Seed pleadings
    await db.insert(pleadingsTable).values([
      { tenantId, caseId: case1.id, type: "مذكرة جوابية", content: "رد على ادعاءات الطرف المقابل حول بنود العقد...", status: "SUBMITTED", managerNotes: "يرجى إضافة المستندات الداعمة" },
      { tenantId, caseId: case1.id, type: "مذكرة ختامية", content: "ملخص القضية والطلبات النهائية...", status: "DRAFT" },
      { tenantId, caseId: case2.id, type: "طلب تنفيذ", content: "طلب تنفيذ الحكم الصادر...", status: "SUBMITTED" },
    ]);

    // Seed hearings - one upcoming (in 2 days) for testing 48h alert
    const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    await db.insert(hearingsTable).values([
      { tenantId, caseId: case1.id, hijriDate: "1446/08/25", utcDate: twoDaysFromNow, attendance: "حضر الطرفان", requiresLawsuitEditing: true },
      { tenantId, caseId: case2.id, hijriDate: "1446/09/01", utcDate: sevenDaysFromNow, attendance: null, requiresLawsuitEditing: true },
      { tenantId, caseId: case3.id, hijriDate: "1446/07/20", utcDate: pastDate, attendance: "حضر الطرفان", transcriptUrl: "/docs/transcript-001.pdf", hearingReport: "تم الفصل في القضية", requiresLawsuitEditing: false },
    ]);

    // Seed executions
    await db.insert(executionsTable).values([
      { tenantId, caseId: case2.id, executionNumber: "1446/EX/078", type: "تنفيذ مالي", totalAmount: "250000", paidAmount: "100000", remainingAmount: "150000", status: "PARTIAL_PAYMENT" },
      { tenantId, caseId: case3.id, executionNumber: "1446/EX/031", type: "تنفيذ حكم", totalAmount: "80000", paidAmount: "80000", remainingAmount: "0", status: "FULL_PAYMENT" },
    ]);

    // Seed notifications
    await db.insert(notificationsTable).values([
      { tenantId, type: "HEARING_48H_ALERT", message: "تنبيه: جلسة القضية 1446/TC/001 خلال 48 ساعة. يجب رفع مستند تعديل لائحة الدعوى.", relatedEntityId: 1, relatedEntityType: "hearing", isRead: false },
      { tenantId, type: "EXECUTION_REMINDER", message: "تذكير: يرجى تحديث حالة التنفيذ رقم 1446/EX/078. المبلغ المتبقي: 150,000 ريال.", relatedEntityId: 1, relatedEntityType: "execution", isRead: false },
      { tenantId, type: "GENERAL", message: "مرحباً بك في نظام إدارة مكتب المحامي ماجد بن سلطان السبيعي.", isRead: true },
    ]);

    // Seed activity log
    await db.insert(activityLogTable).values([
      { tenantId, type: "CLIENT_CREATED", description: "تم إنشاء موكل جديد: شركة الخليج للتطوير", entityId: client1.id, entityType: "client" },
      { tenantId, type: "CASE_CREATED", description: "تم إنشاء قضية جديدة: 1446/TC/001", entityId: case1.id, entityType: "case" },
      { tenantId, type: "HEARING_CREATED", description: "تم تسجيل جلسة جديدة بتاريخ: 1446/08/25", entityId: 1, entityType: "hearing" },
      { tenantId, type: "PLEADING_CREATED", description: "تم إنشاء مذكرة جوابية للقضية 1446/TC/001", entityId: 1, entityType: "pleading" },
    ]);

    logger.info("Database seeded successfully");
    logger.info("Login credentials: manager@lawfirm.sa / admin123 (SYSTEM_MANAGER)");
    logger.info("Login credentials: tech@lawfirm.sa / tech123 (TECHNICIAN)");
  } catch (err) {
    logger.error({ err }, "Seed error");
  }
}
