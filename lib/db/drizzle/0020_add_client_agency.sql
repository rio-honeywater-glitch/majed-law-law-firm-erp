ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "agency_number" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "agency_end_date" date;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "agency_source" text;

ALTER TABLE "clients"
  DROP CONSTRAINT IF EXISTS "clients_agency_source_check";

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_agency_source_check"
  CHECK (
    "agency_source" IS NULL
    OR "agency_source" IN ('خدمات الموثقين', 'الخدمات الالكترونية')
  );