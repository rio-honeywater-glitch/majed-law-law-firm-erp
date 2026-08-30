import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { logger } from "../lib/logger";

// A forgeable token defeats all tenant isolation, so never fall back to a
// hardcoded secret. Require a real signing secret from the environment.
const JWT_SECRET_ENV = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
if (!JWT_SECRET_ENV) {
  throw new Error("JWT_SECRET (or SESSION_SECRET) must be set — refusing to start with a hardcoded token secret.");
}
const JWT_SECRET: string = JWT_SECRET_ENV;

export interface AuthPayload {
  userId: number;
  email: string;
  role: "SYSTEM_MANAGER" | "TECHNICIAN";
  tenantId: number;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

// Cache tenant status briefly so suspension takes effect within TTL without
// a DB round-trip on every request.
const TENANT_STATUS_TTL_MS = 15_000;
const tenantStatusCache = new Map<number, { status: string; expires: number }>();

async function getTenantStatus(tenantId: number): Promise<string | null> {
  const cached = tenantStatusCache.get(tenantId);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.status;
  const [tenant] = await db
    .select({ status: tenantsTable.status })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  const status = tenant?.status ?? null;
  if (status) tenantStatusCache.set(tenantId, { status, expires: now + TENANT_STATUS_TTL_MS });
  return status;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    const validRole =
      payload.role === "SYSTEM_MANAGER" ||
      payload.role === "TECHNICIAN";
    const validTenant = typeof payload.tenantId === "number";
    if (!validRole || !validTenant) {
      logger.warn({ role: payload.role }, "Rejecting token with invalid tenant/role claims");
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // Fail closed: a missing tenant row also denies access.
    const status = await getTenantStatus(payload.tenantId);
    if (status !== "ACTIVE") {
      res.status(403).json({
        error: "تم إيقاف وصول المكتب مؤقتاً.",
      });
      return;
    }

    req.auth = payload;
    next();
  } catch (err) {
    logger.warn({ err }, "Invalid JWT token");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireSystemManager(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.auth.role !== "SYSTEM_MANAGER") {
    res.status(403).json({ error: "Access denied. This resource requires SYSTEM_MANAGER role." });
    return;
  }
  next();
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
