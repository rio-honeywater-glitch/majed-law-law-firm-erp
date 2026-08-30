ALTER TABLE "client_reports" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN IF NOT EXISTS "last_sent_to" text;
--> statement-breakpoint
ALTER TABLE "client_reports" ADD COLUMN IF NOT EXISTS "last_sent_by" text;