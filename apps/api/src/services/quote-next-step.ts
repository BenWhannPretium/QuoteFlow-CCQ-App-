import type { QuoteDetail, QuoteNextStep } from '@ccq/contracts';
import { ROI_OWNER_ROLES, nextStep, type Actor, type WorkflowConfig } from '@ccq/domain';

/** The parts of the quote detail the next step is read from (everything but the next step itself). */
export type NextStepSource = Pick<
  QuoteDetail,
  | 'stageKey'
  | 'status'
  | 'kamUserId'
  | 'kamName'
  | 'reviewDate'
  | 'rework'
  | 'availableActions'
  | 'engineering'
  | 'quoting'
  | 'commercial'
>;

/**
 * UX-002: "whose move is it", from the quote detail the caller is about to get. Every input is something
 * the detail already reports for this caller (what they may assign, edit, review or decide), so the line
 * the web shows cannot offer a move a route would refuse. The rules are the domain's `nextStep`.
 */
export function quoteNextStep(
  workflow: WorkflowConfig,
  actor: Actor,
  quote: NextStepSource,
): QuoteNextStep {
  const { engineering, quoting } = quote;
  const submittedAt = (review: QuoteDetail['engineering']['leadReview']) =>
    review.status === 'submitted' ? review.submittedAt : null;
  return nextStep(workflow, {
    stageKey: quote.stageKey,
    status: quote.status === 'closed' || quote.status === 'on_hold' ? quote.status : 'active',
    readerId: actor.userId,
    readerRoles: actor.roles,
    kam: { id: quote.kamUserId, name: quote.kamName },
    reworkSince: quote.rework?.decidedAt ?? null,
    hold:
      quote.status === 'on_hold'
        ? {
            reviewDate: quote.reviewDate,
            ownerName: quote.commercial.hold.ownerName,
            reasonLabel: quote.commercial.hold.reasonLabel,
          }
        : null,
    work: {
      engineering: {
        assigneeId: engineering.assignedEngineerId,
        assigneeName: engineering.assignedEngineerName,
        submittedAt: submittedAt(engineering.leadReview),
        canAssign: engineering.canAssign,
        canWork: engineering.canEdit,
        canReview: engineering.leadReview.canSendBack,
        // FB-16: the capacity rows and sign-off belong to the production scheduler, when one is assigned.
        capacity: {
          ownerId: engineering.assignedSchedulerId,
          decided: engineering.capacitySignoff.status !== null,
          canWork: engineering.canEditCapacity || engineering.canSignOffCapacity,
        },
      },
      pricing: {
        assigneeId: quoting.assignedPricerId,
        assigneeName: quoting.assignedPricerName,
        submittedAt: submittedAt(quoting.leadReview),
        canAssign: quoting.canAssign,
        canWork: quoting.canEdit,
        canReview: quoting.leadReview.canSendBack,
      },
    },
    payback: {
      waiting: quoting.inQuoting && quoting.steps.current === 'roi',
      // The fallback uploaders (the pricing lead, Admin) may upload it; the step is its owner's.
      canUpload:
        quoting.steps.roi.canUpload && actor.roles.some((role) => ROI_OWNER_ROLES.includes(role)),
    },
    // A gate is decidable when the caller is offered an outcome that nothing blocks.
    decidableGateKeys: [
      ...new Set(
        quote.availableActions.filter((a) => a.missing.length === 0).map((a) => a.gateKey),
      ),
    ],
  });
}
