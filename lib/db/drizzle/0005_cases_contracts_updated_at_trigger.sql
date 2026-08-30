-- Add updated_at column to cases table
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

-- Add updated_at column to contracts table
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

-- Ensure the shared set_updated_at() function exists (idempotent)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for cases
DROP TRIGGER IF EXISTS cases_set_updated_at ON cases;
CREATE TRIGGER cases_set_updated_at
BEFORE UPDATE ON cases
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Trigger for contracts
DROP TRIGGER IF EXISTS contracts_set_updated_at ON contracts;
CREATE TRIGGER contracts_set_updated_at
BEFORE UPDATE ON contracts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
