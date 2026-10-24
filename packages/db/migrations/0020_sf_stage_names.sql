-- Salesforce spells the won stage "Closed Won - Product Shipping" (hyphen; read from OpportunityStage on
-- 2026-10-24), not with the en dash the config seed used, so the stage-mismatch flag never matched a won
-- opportunity. Rename the seeded row; the config seed keeps it in step from here. A hyphen row that
-- already exists (added by an admin) wins and the en-dash row goes.
DELETE FROM "sf_stage_map" WHERE "sf_stage" = 'Closed Won – Product Shipping'
  AND EXISTS (SELECT 1 FROM "sf_stage_map" WHERE "sf_stage" = 'Closed Won - Product Shipping');--> statement-breakpoint
UPDATE "sf_stage_map" SET "sf_stage" = 'Closed Won - Product Shipping', "updated_at" = now()
  WHERE "sf_stage" = 'Closed Won – Product Shipping';
