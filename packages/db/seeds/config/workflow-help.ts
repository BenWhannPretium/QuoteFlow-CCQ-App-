/**
 * B-26 (CCQ demo, 10/20, Bailey): the definition shown next to every decision option, so nobody has
 * to guess what Hold or Stop does or where the quote goes. They are the admin-editable `help_text` of
 * the workflow config (Admin → Workflow), seeded here as drafts. Provisional: Bailey supplies the final
 * wording; replacing it is a config edit, not a code change.
 */

/** `gate/outcome` → definition. */
export const OUTCOME_HELP: Record<string, string> = {
  // G1 Qualify & prioritize (Sales leadership, with Marketing and upfront Engineering)
  'G1/advance':
    'Pursue it. The quote goes to the prioritized engineering queue with its priority tier, and the engineering lead is told.',
  'G1/hold':
    'Pause it in Intake (for example, waiting on the customer). The clock stops. Needs a reason, an owner and a review date.',
  'G1/rework':
    'Send it back to the KAM to fix the intake. Say exactly what is missing; the KAM resubmits it.',
  'G1/redirect':
    'Not CCQ work (stock, stock-plus, a price inquiry, capital not tied to a quote). It closes as Redirected so it can take its own path.',
  'G1/stop': 'Do not pursue. It closes as Declined, with the reason recorded.',
  'SUBMIT/submit': 'Send the intake to the engineering queue.',
  // G2 Feasible solution? (upfront Engineering lead; the capacity owner signs off)
  'G2/proceed':
    'The solution is feasible: the quote goes to Quoting. Needs the solution fields, capacity evidence and the capacity sign-off.',
  'G2/proceed_with_risk':
    'Feasible, with a stated risk or condition (say what it is). The quote goes to Quoting and the risk travels with it.',
  'G2/capital_required':
    'Feasible, but capital is needed. Record the preliminary capital estimate; Pricing then confirms capital readiness before any price is released.',
  'G2/hold':
    'Pause it in Engineering Review. The clock stops. Needs a reason, an owner and a review date.',
  'G2/rework':
    'Not enough technical information. It goes back to the KAM to get it from the customer; say exactly what is needed.',
  'G2/redirect':
    'Work an alternative platform or site instead. The quote stays in Engineering Review; the note says what changes.',
  'G2/stop': 'Not feasible, or not worth pursuing. It closes as Declined, with the reason recorded.',
  // G3 Price approved & capital ready (Pricing)
  'G3/submit':
    'The cost sheet is done, the price is approved and capital readiness is confirmed. The quote goes to Final Review.',
  'G3/hold':
    'Pause it in Quoting (for example, capital pre-approval pending). The clock stops. Needs a reason, an owner and a review date.',
  'G3/recost':
    'Rework the cost: the quote stays in Quoting and the cost sheet is redone (the costing attestation is cleared).',
  'G3/rework':
    'Back to Engineering to revisit feasibility (Stage 2). The quote version goes up; earlier decisions stay on record.',
  'G3/redirect':
    'Use another capital model (for example, customer-funded tooling). The quote stays in Quoting; the note says what changes.',
  'G3/stop': 'Not economically viable. It closes as Declined, with the reason recorded.',
  // G4 Release proposition (Commercial approver)
  'G4/approve':
    'Release the offer. The KAM issues the proposal and the validity clock starts. Approving is internal: it does not award the quote.',
  'G4/hold':
    'Pause the release. The clock stops. Needs a reason, an owner and a review date.',
  'G4/return':
    'Send it back to the earliest affected gate (Quoting for price, Engineering for scope). The quote version goes up.',
  'G4/decline': 'Withdraw: the offer is not released. It closes as Declined, with the reason recorded.',
  // G5 Outcome recorded (the KAM records; a sales leader verifies closure)
  'G5/awarded':
    'The customer awarded it (verbal award, PO, LOI or contract). It moves to Commit & Hand Off. Acceptance is not permission to spend.',
  'G5/negotiating':
    'The customer countered within the approved range. Record it and re-issue; the quote stays here. A counter outside the range is a Re-quote.',
  'G5/lost': 'The customer chose someone else or cancelled. It closes as Lost, with the reason.',
  'G5/expired':
    'The validity date passed with no answer. Silence is not a loss: it closes as Expired, separately from Lost.',
  'G5/on_hold':
    'The customer put it on hold. The Pretium clock stops. Needs a reason, an owner and a review date.',
  'G5/requote':
    'Something changed (scope, volume, resin, terms). It goes back to the affected gate as a new version; nothing is edited silently.',
  // G6 Commit & hand off (B-26)
  'G6/advance':
    'The CER is approved (or not required) and the receiving team accepted the hand-off. The quote closes Won with its linked IDs.',
  'G6/hold':
    'Commitment pending (for example, the CER is still with the approvers). Needs a reason, an owner and a review date.',
  'G6/requote':
    'Something changed since the quote (scope, volume, resin, site, capacity). It goes back to the affected gate as a new version.',
  'G6/stop':
    'The commitment is not authorized (for example, the CER was not approved). It closes with the reason; escalate to the sponsor.',
};

/** Stage key → what happens in the stage. */
export const STAGE_HELP: Record<string, string> = {
  INTAKE: 'Stage 1: the KAM completes the guided intake (Sales-known fields only) and G1 qualifies it.',
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
