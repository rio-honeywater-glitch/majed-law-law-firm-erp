CREATE TABLE IF NOT EXISTS "client_report_deliveries" (
  "attempt_id" text NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "case_id" integer NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "initiated_by_user_id" integer NOT NULL,
  "requested_report_id" integer,
  "saved_report_id" integer REFERENCES "client_reports"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "report_data" jsonb NOT NULL,
  "sender_email" text NOT NULL,
  "recipient" text NOT NULL,
  "sent_by" text NOT NULL,
  "provider_message_id" text,
  "provider_accepted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "attempt_id")
);