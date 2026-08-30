CREATE TABLE "expo_push_receipt_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer,
	"delivery_group_id" text NOT NULL,
	"expo_ticket_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"subscription_id" integer,
	"notification_title" text NOT NULL,
	"notification_body" text,
	"notification_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"receipt_status" text,
	"error_code" text
);
--> statement-breakpoint
ALTER TABLE "expo_push_receipt_queue" ADD CONSTRAINT "expo_push_receipt_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expo_push_receipt_queue" ADD CONSTRAINT "expo_push_receipt_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
