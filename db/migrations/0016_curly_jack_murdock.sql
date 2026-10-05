CREATE TYPE "public"."demonstration_media_misinfo_status" AS ENUM('unchecked', 'checking', 'clear', 'flagged');--> statement-breakpoint
CREATE TABLE "demonstration_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demonstration_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"embed_url" text NOT NULL,
	"caption" text,
	"observed_at" timestamp with time zone NOT NULL,
	"misinfo_status" "demonstration_media_misinfo_status" DEFAULT 'unchecked' NOT NULL,
	"misinfo_note" text,
	"reverse_image_earlier_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demonstration_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demonstration_id" uuid NOT NULL,
	"status" "demonstration_status" NOT NULL,
	"note" text,
	"changed_by" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demonstration_media" ADD CONSTRAINT "demonstration_media_demonstration_id_demonstrations_id_fk" FOREIGN KEY ("demonstration_id") REFERENCES "public"."demonstrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demonstration_status_events" ADD CONSTRAINT "demonstration_status_events_demonstration_id_demonstrations_id_fk" FOREIGN KEY ("demonstration_id") REFERENCES "public"."demonstrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demonstration_status_events" ADD CONSTRAINT "demonstration_status_events_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demonstration_media_demonstration_id_idx" ON "demonstration_media" USING btree ("demonstration_id");--> statement-breakpoint
CREATE INDEX "demonstration_status_events_demonstration_occurred_idx" ON "demonstration_status_events" USING btree ("demonstration_id","occurred_at");