-- B-15 pricing-app reader (F-11): reads are counted in one integration_run row per hour, so the
-- hour is unique for source = 'pricing' (Salesforce keeps one row per sync run).

CREATE UNIQUE INDEX "integration_run_pricing_hour_uq" ON "integration_run" USING btree ("source","started_at") WHERE "integration_run"."source" = 'pricing';