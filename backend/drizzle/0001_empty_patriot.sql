ALTER TABLE "agreements" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN "dispatch_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_a2a_tx" ON "payments" USING btree ("tx_hash") WHERE "payments"."kind" = 'a2a';