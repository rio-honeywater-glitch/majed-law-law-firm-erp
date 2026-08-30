CREATE TABLE IF NOT EXISTS "client_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "case_id" integer NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "title" text NOT NULL DEFAULT 'تقرير العميل',
  "report_data" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
