-- Single-contract tasks: designed terms, A->B legs, and the task contract's Hedera account id.
ALTER TABLE agreements ADD COLUMN IF NOT EXISTS task_account_id text;

CREATE TABLE IF NOT EXISTS contract_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid REFERENCES quotes(id),
  agreement_id uuid REFERENCES agreements(id),
  kind text NOT NULL DEFAULT 'root',
  spec jsonb NOT NULL,
  spec_hash text NOT NULL,
  trust_score numeric(5,1),
  source text NOT NULL,
  deploy_tx text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sub_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  leg_id integer NOT NULL,
  callee_agent_id uuid NOT NULL REFERENCES agents(id),
  payee_address text NOT NULL,
  payee_account_id text NOT NULL,
  price_tinybar numeric(38,0) NOT NULL,
  terms_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payout_tx text,
  add_leg_tx text,
  a2a_call_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sub_legs_agreement_leg ON sub_legs (agreement_id, leg_id);
