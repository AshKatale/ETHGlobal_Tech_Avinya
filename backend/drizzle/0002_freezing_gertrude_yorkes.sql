CREATE TABLE IF NOT EXISTS "signature_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"agreement_id" uuid NOT NULL,
	"escrow_address" text NOT NULL,
	"signer_address" text NOT NULL,
	"nonce" bigint NOT NULL,
	"result_or_amount" text NOT NULL,
	"sig_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "verifying_since" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_audit_agreement" ON "signature_audit" ("agreement_id");
