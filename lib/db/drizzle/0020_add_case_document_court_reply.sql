ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "court_reply_type" text;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "court_notes" text;