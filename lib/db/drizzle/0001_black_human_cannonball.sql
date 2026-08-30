CREATE TABLE "transfer_order_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "gregorian_date" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "client_national_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "client_address" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "client_phone" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "client_email" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "case_number" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "court_name" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "case_subject" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "representation_scope" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "fee_installments" jsonb;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deleted_by_name" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deleted_by_role" text;--> statement-breakpoint
ALTER TABLE "pleadings" ADD COLUMN "added_by_id" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "last_withdrawal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "last_withdrawal_by" text;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "last_transfer_order_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "link_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfer_order_logs" ADD CONSTRAINT "transfer_order_logs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_logs" ADD CONSTRAINT "transfer_order_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pleadings" ADD CONSTRAINT "pleadings_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;