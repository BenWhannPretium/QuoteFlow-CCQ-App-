ALTER TABLE "quote" ADD COLUMN "eng_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "eng_submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "eng_returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "eng_returned_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "eng_return_note" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pricing_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pricing_submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pricing_returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pricing_returned_by" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "pricing_return_note" text;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_eng_submitted_by_app_user_id_fk" FOREIGN KEY ("eng_submitted_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_eng_returned_by_app_user_id_fk" FOREIGN KEY ("eng_returned_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_pricing_submitted_by_app_user_id_fk" FOREIGN KEY ("pricing_submitted_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_pricing_returned_by_app_user_id_fk" FOREIGN KEY ("pricing_returned_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;