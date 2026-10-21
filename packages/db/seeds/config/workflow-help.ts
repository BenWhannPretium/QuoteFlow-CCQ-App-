/**
 * B-26: what happens in each stage (the stages' admin-editable `help_text`), from the future-state
 * process deck. Provisional drafts. The outcome definitions live with the workflow seed in the domain
 * (`packages/domain/src/workflow/seeds/outcome-help.ts`).
 */
/** Stage key → what happens in the stage. */
export const STAGE_HELP: Record<string, string> = {
  INTAKE:
    'Stage 1: the KAM completes the guided intake (Sales-known fields only) and G1 qualifies it.',
  ENG_REVIEW:
    'Stage 2: Engineering, Operations and Supply Chain prove feasibility together, with capacity evidence and a capital estimate.',
  QUOTING:
    'Stage 3: cost comes before price. Cost-to-Serve builds the cost, Pricing approves the price and capital readiness is confirmed.',
  FINAL_REVIEW:
    'Stage 4: the offer is approved internally (terms checked, Legal when triggered) before the customer sees it.',
  CUSTOMER_DECISION:
    'Stage 5: every customer response is recorded. Acceptance is not spend authority.',
  COMMIT_HANDOFF:
    'Stage 6: spend is authorized (the CER) and the receiving team accepts the hand-off before the quote closes Won.',
};
