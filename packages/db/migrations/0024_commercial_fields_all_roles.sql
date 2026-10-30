-- 2026-10-30 (Ben): every role that reads a quote sees its commercial fields (quote.read.commercialFields
-- is granted to every role in packages/domain/src/policy/matrix.ts), so the pricing-app history is
-- readable by every role too. Still no request context → no roles → nothing. Writes stay Admin only.
DROP POLICY IF EXISTS pricing_history_record_app_select ON pricing_history_record;--> statement-breakpoint
CREATE POLICY pricing_history_record_app_select ON pricing_history_record FOR SELECT TO ccq_app
  USING (app_roles() && ARRAY['KAM', 'SalesLeader', 'EngLead', 'Engineer', 'Pricing', 'PricingLead', 'Approver', 'Leadership', 'Admin', 'PostAward']::text[]);
