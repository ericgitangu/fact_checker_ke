ALTER TABLE "checks" ADD COLUMN "raw_confidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "agreement_state" text;