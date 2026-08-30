ALTER TABLE "hearings" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "hearings" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "case_id" integer;--> statement-breakpoint
ALTER TABLE "expo_push_receipt_queue" ADD COLUMN "delivery_group_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "expo_push_receipt_queue" ADD COLUMN "endpoint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "expo_push_receipt_queue" ADD COLUMN "subscription_id" integer;--> statement-breakpoint
ALTER TABLE "expo_push_receipt_queue" ADD COLUMN "receipt_status" text;--> statement-breakpoint
ALTER TABLE "expo_push_receipt_queue" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;