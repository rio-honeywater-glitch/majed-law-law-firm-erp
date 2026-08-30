-- Function: automatically set updated_at = now() on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: fire before each UPDATE on executions
DROP TRIGGER IF EXISTS executions_set_updated_at ON executions;
CREATE TRIGGER executions_set_updated_at
BEFORE UPDATE ON executions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
