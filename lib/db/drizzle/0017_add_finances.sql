CREATE TABLE IF NOT EXISTS "expenses" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "expense_type" text NOT NULL,
  "total_amount" numeric(12, 2) NOT NULL,
  "installments_count" integer NOT NULL DEFAULT 1,
  "payment_duration_months" integer,
  "single_due_date" date,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expense_payments" (
  "id" serial PRIMARY KEY,
  "expense_id" integer NOT NULL REFERENCES "expenses"("id") ON DELETE CASCADE,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "installment_number" integer NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "due_date" date NOT NULL,
  "is_paid" boolean NOT NULL DEFAULT false,
  "paid_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "contract_payments" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contract_id" integer NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "due_date" date,
  "is_paid" boolean NOT NULL DEFAULT false,
  "paid_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
