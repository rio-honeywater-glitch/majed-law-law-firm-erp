import { Router, type IRouter, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { requireAuth, requireSystemManager } from "../middlewares/auth";
import { scoped } from "../lib/tenant";
import { UPLOADS_DIR, generateContractPdf } from "../lib/contract-pdf";
import { db, contractsTable, clientsTable } from "@workspace/db";

const router: IRouter = Router();
router.use(requireAuth);
// Contract PDFs contain fee data that is redacted from technicians,
// so downloads are manager-only.
router.use(requireSystemManager);

const CONTRACT_PDF_PATTERN = /^contract-(\d+)-[a-f0-9]{16}\.pdf$/;
const SIGNED_CONTRACT_PDF_PATTERN = /^signed-contract-(\d+)-[a-f0-9]{16}\.pdf$/;

router.get("/:filename", async (req: Request, res: Response) => {
  const filename = path.basename(req.params["filename"] as string);

  // ── Signed contract uploads (user-uploaded, no auto-regeneration) ──────────
  const signedMatch = SIGNED_CONTRACT_PDF_PATTERN.exec(filename);
  if (signedMatch) {
    const contractId = parseInt(signedMatch[1] as string, 10);
    // Verify the contract belongs to this tenant and the signedPdfUrl matches
    const [row] = await db
      .select({ signedPdfUrl: contractsTable.signedPdfUrl })
      .from(contractsTable)
      .where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, contractId)))
      .limit(1);
    if (!row || row.signedPdfUrl !== `/api/uploads/${filename}`) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "ملف العقد الموقع غير موجود على الخادم. يرجى رفعه مجدداً." });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.sendFile(filePath);
    return;
  }

  // ── Generated contract PDFs (auto-regenerate if missing) ──────────────────
  const match = CONTRACT_PDF_PATTERN.exec(filename);
  if (!match) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  let serveFilename = filename;
  let filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    // The file may have been wiped by a redeploy (ephemeral filesystem).
    // Regenerate it from the contract data instead of returning 404.
    const contractId = parseInt(match[1] as string, 10);
    const [row] = await db
      .select({ contract: contractsTable, clientName: clientsTable.name })
      .from(contractsTable)
      .leftJoin(clientsTable, eq(contractsTable.clientId, clientsTable.id))
      .where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, contractId)))
      .limit(1);

    if (!row || row.contract.pdfUrl !== `/api/uploads/${filename}`) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    try {
      req.log.warn({ contractId, filename }, "contract PDF missing on disk, regenerating");
      const newPdfUrl = await generateContractPdf({
        id: row.contract.id,
        clientName: row.clientName ?? "غير محدد",
        serviceType: row.contract.serviceType,
        hijriDate: row.contract.hijriDate,
        preamble: row.contract.preamble,
        fees: row.contract.fees,
        isSigned: row.contract.isSigned,
        customClauses: row.contract.customClauses ?? [],
        createdAt: row.contract.createdAt,
      });
      await db.update(contractsTable).set({ pdfUrl: newPdfUrl }).where(scoped(req, contractsTable.tenantId, eq(contractsTable.id, contractId)));
      serveFilename = path.basename(newPdfUrl);
      filePath = path.join(UPLOADS_DIR, serveFilename);
    } catch (pdfErr) {
      req.log.error({ err: pdfErr }, "PDF regeneration on download failed");
      res.status(500).json({ error: "تعذّرت إعادة توليد ملف العقد. يرجى المحاولة مرة أخرى." });
      return;
    }
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${serveFilename}"`);
  res.sendFile(filePath);
});

export default router;
