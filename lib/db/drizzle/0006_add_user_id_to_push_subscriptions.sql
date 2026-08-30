-- Add user_id column to push_subscriptions so subscriptions can be
-- targeted to specific users rather than broadcast to the whole tenant.
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_id" integer REFERENCES "users"("id") ON DELETE CASCADE;
