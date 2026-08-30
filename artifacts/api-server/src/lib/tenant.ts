import { and, eq, sql, SQL } from "drizzle-orm";
import type { Request } from "express";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Builds a WHERE condition scoped to the caller's firm.
 *
 * Every authenticated user carries a numeric tenantId. If it is missing
 * (stale/malformed token), we FAIL CLOSED by injecting an always-false
 * predicate so the query can never run unscoped and leak across firms.
 *
 * Extra conditions are AND-combined; undefined ones are ignored by drizzle.
 *
 * Usage: `.where(scoped(req, table.tenantId, eq(table.id, id)))`
 */
export function scoped(
  req: Request,
  tenantCol: PgColumn,
  ...extra: (SQL | undefined)[]
): SQL | undefined {
  const conds: (SQL | undefined)[] = [...extra];
  const tid = req.auth?.tenantId;
  if (typeof tid !== "number") {
    // Fail closed — never run an unscoped query.
    conds.unshift(sql`false`);
    return and(...conds);
  }
  conds.unshift(eq(tenantCol, tid));
  return and(...conds);
}

/**
 * The firm id to stamp on newly created rows. Every authenticated user carries a
 * numeric tenantId; the guard below is defense-in-depth.
 */
export function tenantStamp(req: Request): number {
  const tid = req.auth?.tenantId;
  if (typeof tid !== "number") {
    throw Object.assign(new Error("No firm context for this operation"), { status: 403 });
  }
  return tid;
}
