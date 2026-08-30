CREATE TABLE "push_failed_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer,
	"endpoint" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"failure_reason" text,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_failed_notifications" ADD CONSTRAINT "push_failed_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_failed_notifications" ADD CONSTRAINT "push_failed_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;