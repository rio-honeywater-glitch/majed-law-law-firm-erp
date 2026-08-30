import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  caseDocumentsTable,
  casesTable,
  clientsTable,
  db,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

process.env.NODE_ENV = "test";

const { default: app } = await import("../app.js");
const { signToken } = await import("../middlewares/auth.js");

interface Fixtures {
  tenantId: number;
  caseId: number;
  userId: number;
  token: string;
  foreignTenantId: number;
  foreignToken: string;
}

let fx: Fixtures;

function authed() {
  return { Authorization: `Bearer ${fx.token}` };
}

async function createDocument(values: {
  submittedToCourt: boolean;
  courtReplyType?: "PLAINTIFF" | "DEFENDANT" | null;
  courtNotes?: string | null;
  submittedByName?: string | null;
  submittedByRole?: string | null;
}) {
  const [document] = await db
    .insert(caseDocumentsTable)
    .values({
      caseId: fx.caseId,
      tenantId: fx.tenantId,
      fileName: `document_${Date.now()}_${Math.random().toString(16).slice(2)}.pdf`,
      mimeType: "application/pdf",
      fileData: "JVBERi0x",
      ...values,
    })
    .returning({ id: caseDocumentsTable.id });
  assert.ok(document);
  return document.id;
}

before(async () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: `__test_case_documents_${suffix}__`, status: "ACTIVE" })
    .returning({ id: tenantsTable.id });
  const [user] = await db
    .insert(usersTable)
    .values({
      tenantId: tenant!.id,
      email: `case_documents_${suffix}@example.com`,
      passwordHash: "test-hash",
      name: "مستخدم اختبار المستندات",
      role: "TECHNICIAN",
    })
    .returning({ id: usersTable.id });
  const [client] = await db
    .insert(clientsTable)
    .values({ tenantId: tenant!.id, name: "عميل اختبار مستندات القضية" })
    .returning({ id: clientsTable.id });
  const [caseRow] = await db
    .insert(casesTable)
    .values({
      tenantId: tenant!.id,
      clientId: client!.id,
      subject: "قضية اختبار مستندات المحكمة",
    })
    .returning({ id: casesTable.id });

  const [foreignTenant] = await db
    .insert(tenantsTable)
    .values({ name: `__test_case_documents_foreign_${suffix}__`, status: "ACTIVE" })
    .returning({ id: tenantsTable.id });
  const [foreignUser] = await db
    .insert(usersTable)
    .values({
      tenantId: foreignTenant!.id,
      email: `case_documents_foreign_${suffix}@example.com`,
      passwordHash: "test-hash",
      name: "مستخدم اختبار مستأجر آخر",
      role: "TECHNICIAN",
    })
    .returning({ id: usersTable.id });

  fx = {
    tenantId: tenant!.id,
    caseId: caseRow!.id,
    userId: user!.id,
    token: signToken({
      userId: user!.id,
      email: `case_documents_${suffix}@example.com`,
      role: "TECHNICIAN",
      tenantId: tenant!.id,
    }),
    foreignTenantId: foreignTenant!.id,
    foreignToken: signToken({
      userId: foreignUser!.id,
      email: `case_documents_foreign_${suffix}@example.com`,
      role: "TECHNICIAN",
      tenantId: foreignTenant!.id,
    }),
  };
});


after(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.id, fx.tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, fx.foreignTenantId));
});

describe("Case document court classification", () => {
  test("unsubmitting with only submittedToCourt=false clears classification and submitter data", async () => {
    const documentId = await createDocument({
      submittedToCourt: true,
      courtReplyType: "DEFENDANT",
      courtNotes: "ملاحظات محفوظة قبل الإلغاء",
      submittedByName: "رافع المستند",
      submittedByRole: "TECHNICIAN",
    });

    const updateResponse = await request(app)
      .patch(`/api/cases/${fx.caseId}/documents/${documentId}`)
      .set(authed())
      .send({ submittedToCourt: false })
      .expect(200);

    assert.equal(updateResponse.body.submittedToCourt, false);
    assert.equal(updateResponse.body.courtReplyType, null);
    assert.equal(updateResponse.body.courtNotes, null);
    assert.equal(updateResponse.body.submittedByName, null);
    assert.equal(updateResponse.body.submittedByRole, null);

    const listResponse = await request(app)
      .get(`/api/cases/${fx.caseId}/documents`)
      .set(authed())
      .expect(200);
    const document = listResponse.body.find(
      (item: { id: number }) => item.id === documentId,
    );
    assert.ok(document);
    assert.equal(document.submittedToCourt, false);
    assert.equal(document.courtReplyType, null);
    assert.equal(document.courtNotes, null);
    assert.equal(document.submittedByName, null);
    assert.equal(document.submittedByRole, null);
  });

  test("rejects non-empty notes when no reply type is selected", async () => {
    const documentId = await createDocument({ submittedToCourt: true });

    await request(app)
      .patch(`/api/cases/${fx.caseId}/documents/${documentId}`)
      .set(authed())
      .send({ courtNotes: "ملاحظات بلا نوع رد" })
      .expect(400);

    const [document] = await db
      .select({
        courtReplyType: caseDocumentsTable.courtReplyType,
        courtNotes: caseDocumentsTable.courtNotes,
      })
      .from(caseDocumentsTable)
      .where(and(
        eq(caseDocumentsTable.id, documentId),
        eq(caseDocumentsTable.tenantId, fx.tenantId),
      ))
      .limit(1);
    assert.equal(document?.courtReplyType, null);
    assert.equal(document?.courtNotes, null);
  });

  test("keeps reply type and notes when the updated document is read again", async () => {
    const documentId = await createDocument({ submittedToCourt: false });

    await request(app)
      .patch(`/api/cases/${fx.caseId}/documents/${documentId}`)
      .set(authed())
      .send({
        submittedToCourt: true,
        courtReplyType: "PLAINTIFF",
        courtNotes: "ملاحظات رد المدعي",
      })
      .expect(200);

    const listResponse = await request(app)
      .get(`/api/cases/${fx.caseId}/documents`)
      .set(authed())
      .expect(200);
    const document = listResponse.body.find(
      (item: { id: number }) => item.id === documentId,
    );
    assert.ok(document);
    assert.equal(document.submittedToCourt, true);
    assert.equal(document.courtReplyType, "PLAINTIFF");
    assert.equal(document.courtNotes, "ملاحظات رد المدعي");
    assert.equal(document.submittedByName, "مستخدم اختبار المستندات");
    assert.equal(document.submittedByRole, "TECHNICIAN");
  });

  test("rejects a document update from another tenant without changing the document", async () => {
    const documentId = await createDocument({
      submittedToCourt: true,
      courtReplyType: "DEFENDANT",
      courtNotes: "ملاحظات المستأجر الأصلي",
      submittedByName: "مستخدم المستأجر الأصلي",
      submittedByRole: "TECHNICIAN",
    });

    await request(app)
      .patch(`/api/cases/${fx.caseId}/documents/${documentId}`)
      .set({ Authorization: `Bearer ${fx.foreignToken}` })
      .send({
        submittedToCourt: false,
        courtNotes: null,
      })
      .expect(404);

    const [document] = await db
      .select({
        submittedToCourt: caseDocumentsTable.submittedToCourt,
        courtReplyType: caseDocumentsTable.courtReplyType,
        courtNotes: caseDocumentsTable.courtNotes,
        submittedByName: caseDocumentsTable.submittedByName,
        submittedByRole: caseDocumentsTable.submittedByRole,
      })
      .from(caseDocumentsTable)
      .where(eq(caseDocumentsTable.id, documentId))
      .limit(1);

    assert.deepEqual(document, {
      submittedToCourt: true,
      courtReplyType: "DEFENDANT",
      courtNotes: "ملاحظات المستأجر الأصلي",
      submittedByName: "مستخدم المستأجر الأصلي",
      submittedByRole: "TECHNICIAN",
    });
  });
});