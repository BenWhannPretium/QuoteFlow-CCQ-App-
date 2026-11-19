import type {
  ClosureSummary,
  CodeLabel,
  CustomerDecisionDetail,
  HandoffRecord,
  SfStageComparison,
  ValidityStatus,
  QuoteSfWriteback,
  SfWritebackStatus,
} from '@ccq/contracts';
import type { DbOrTx } from '@ccq/db';
import {
  getHandoffRecord,
  getSetting,
  listCurrentModelVersions,
  listSfStageMap,
  listUsersByIds,
  type HandoffRecordRow,
  type Quote,
  type listGateDecisionsWithNames,
} from '@ccq/db/repos';
import {
  ACCEPTANCE_EVIDENCE_TYPES,
  CUSTOMER_DECISION_STAGE_KEY,
  HANDOFF_RECEIVING_ROLES_SEED,
  HANDOFF_STAGE_KEYS,
  NEGOTIATING_OUTCOME,
  VALIDITY_WARNING_DAYS_SEED,
  can,
  compareSfStage,
  parseSalesforceInstanceUrl,
  parseSfOutcomeStageNames,
  SF_OUTCOME_STAGE_NAMES_SEED,
  customerOutcomeKeys,
  parseCerLinkUrl,
  parseReceivingRoles,
  parseValidityWarningDays,
  validityStatus,
  type Actor,
  type DomainError,
  type HandoffValues,
  type QuoteState,
  type ReceivingRoleOption,
  type SfStageMapEntry,
  type WorkflowConfig,
  type SfWritebackSkipReason,
} from '@ccq/domain';

import { SF_WRITEBACK_SETTING_KEYS, latestStageRowForQuote } from './sfWritebackStore';
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const message = (err: unknown) => (err as DomainError).message ?? String(err);

/**
 * B-13 settings for the customer decision, read once per request: the validity warning window
 * (`validity_warning_days`), the hand-off receiving roles (`handoff_receiving_roles`) and the SF stage
 * map. A malformed setting falls back to the seed for display and keeps the error, so a hand-off edit
 * against a broken role list is refused rather than guessed.
 */
export interface OutcomeSettings {
  warningDays: number;
  receivingRoles: ReceivingRoleOption[];
  receivingRolesError: string | null;
  sfStageMap: SfStageMapEntry[];
  /** FB-04 (F-076): the Lightning base URL ('' = not set) and outcome key → Salesforce stage name. */
  salesforceInstanceUrl: string;
  sfOutcomeStageNames: Record<string, string>;
  /** FB-26 (N17-32): the CER links ('' = not set) and whether an Approved CER needs a proof file. */
  cerToolUrl: string;
  cerTemplateUrl: string;
  cerProofRequired: boolean;
}

export async function loadOutcomeSettings(db: DbOrTx): Promise<OutcomeSettings> {
  const [days, roles, map, instanceUrl, outcomeStages, cerTool, cerTemplate, cerProof] =
    await Promise.all([
      getSetting(db, 'validity_warning_days'),
      getSetting(db, 'handoff_receiving_roles'),
      listSfStageMap(db),
      getSetting(db, 'salesforce_instance_url'),
      getSetting(db, 'sf_outcome_stage_names'),
      getSetting(db, 'cer_tool_url'),
      getSetting(db, 'cer_template_url'),
      getSetting(db, 'handoff_cer_proof_required'),
    ]);
  // FB-26 (N17-32): display only: a malformed link is hidden rather than breaking the quote page.
  const cerLink = (v: unknown, key: string) => {
    try {
      return parseCerLinkUrl(v, key);
    } catch {
      return '';
    }
  };
  // Display only: a malformed value hides the link / reminder stage rather than breaking the quote page.
  let salesforceInstanceUrl = '';
  try {
    salesforceInstanceUrl = parseSalesforceInstanceUrl(instanceUrl);
  } catch {
    // keep ''
  }
  let sfOutcomeStageNames: Record<string, string> = { ...SF_OUTCOME_STAGE_NAMES_SEED };
  try {
    if (outcomeStages !== undefined) sfOutcomeStageNames = parseSfOutcomeStageNames(outcomeStages);
  } catch {
    // keep the seed
  }
  let warningDays = VALIDITY_WARNING_DAYS_SEED;
  try {
    warningDays = parseValidityWarningDays(days);
  } catch {
    // Display only: the seed window is a safe fallback for an amber chip.
  }
  let receivingRoles = [...HANDOFF_RECEIVING_ROLES_SEED];
  let receivingRolesError: string | null = null;
  try {
    receivingRoles = parseReceivingRoles(roles);
  } catch (err) {
    receivingRolesError = message(err);
  }
  return {
    warningDays,
    receivingRoles,
    receivingRolesError,
    sfStageMap: map.map((m) => ({ sfStage: m.sfStage, ccqStageHint: m.ccqStageHint })),
    salesforceInstanceUrl,
    sfOutcomeStageNames,
    cerToolUrl: cerLink(cerTool, 'cer_tool_url'),
    cerTemplateUrl: cerLink(cerTemplate, 'cer_template_url'),
    cerProofRequired: cerProof === true,
  };
}

export function validityDto(
  validityUntil: string | null,
  now: Date,
  settings: OutcomeSettings,
): ValidityStatus {
  return {
    ...validityStatus(validityUntil, now, settings.warningDays),
    warningDays: settings.warningDays,
  };
}

export function sfStageDto(
  workflow: WorkflowConfig,
  settings: OutcomeSettings,
  q: Pick<Quote, 'stageKey' | 'sfStatusFlag'>,
  sfStage: string | null | undefined,
): SfStageComparison {
  const label = (key: string) => workflow.stages.find((s) => s.key === key)?.label ?? key;
  return {
    ...compareSfStage({
      ccqStageKey: q.stageKey,
      sfStage,
      map: settings.sfStageMap,
      terminalStageKeys: workflow.stages.filter((s) => s.terminal).map((s) => s.key),
      stageLabel: label,
    }),
    sfStatusFlag: q.sfStatusFlag,
  };
}

/** The awarded reason codes (context `awarded`), as labelled options for the evidence select. */
export function acceptanceEvidenceOptions(workflow: WorkflowConfig): CodeLabel[] {
  return ACCEPTANCE_EVIDENCE_TYPES.map((code) => ({
    code,
    label:
      workflow.reasonCodes.find((r) => r.context === 'awarded' && r.code === code)?.label ?? code,
  }));
}

/** A stored hand-off row as the domain's values. */
export function handoffValues(row: HandoffRecordRow | null | undefined): HandoffValues | null {
  if (!row) return null;
  return {
    acceptanceEvidence: row.acceptanceEvidence as HandoffValues['acceptanceEvidence'],
    acceptanceDate: row.acceptanceDate,
    acceptanceDocumentUrl: row.acceptanceDocumentUrl,
    cerId: row.cerId,
    cerStatus: row.cerStatus as HandoffValues['cerStatus'],
    cerApprovedOn: row.cerApprovedOn,
    receivingRole: row.receivingRole,
    receivingRoleOther: row.receivingRoleOther,
    receivingContactName: row.receivingContactName,
    acceptedOn: row.acceptedOn,
    notes: row.notes,
    completedAt: row.completedAt,
    completedBy: row.completedBy,
    cerReadyAt: row.cerReadyAt,
    cerReadyBy: row.cerReadyBy,
  };
}

type RawDecisions = Awaited<ReturnType<typeof listGateDecisionsWithNames>>;

/** How the quote closed: the quote's closure columns plus the closing decision's context. */
function closureDto(
  workflow: WorkflowConfig,
  q: Quote,
  raw: RawDecisions,
  ownerName: string | null,
): ClosureSummary | null {
  if (q.status !== 'closed' || !q.outcome) return null;
  const closing = raw.find((d) => d.decision.targetStageKey === q.stageKey)?.decision ?? null;
  const outcomeDef = closing
    ? workflow.outcomes.find((o) => o.gateKey === closing.gateKey && o.key === closing.outcomeKey)
    : undefined;
  const contexts = new Set(
    workflow.transitions
      .filter((t) => t.closeAs === q.outcome)
      .map(
        (t) =>
          workflow.outcomes.find((o) => o.gateKey === t.gateKey && o.key === t.outcomeKey)
            ?.reasonContext,
      ),
  );
  if (outcomeDef?.reasonContext) contexts.add(outcomeDef.reasonContext);
  const reason = workflow.reasonCodes.find(
    (r) => r.code === q.outcomeReasonCode && contexts.has(r.context),
  );
  const evidence = (closing?.evidence ?? {}) as { decidedByRoles?: unknown };
  const payload = (closing?.payload ?? {}) as { competitor?: unknown };
  return {
    outcome: q.outcome,
    outcomeLabel: workflow.stages.find((s) => s.key === q.stageKey)?.label ?? q.outcome,
    kind: customerOutcomeKeys(workflow).has(q.outcome) ? 'customer' : 'internal',
    reasonCode: q.outcomeReasonCode,
    reasonLabel: reason?.label ?? q.outcomeReasonCode,
    closureOwnerId: q.closureOwnerId,
    closureOwnerName: ownerName,
    closedAt: iso(q.closedAt),
    gateKey: closing?.gateKey ?? null,
    decidedByName: raw.find((d) => d.decision.id === closing?.id)?.decidedByName ?? null,
    decidedByRoles: Array.isArray(evidence.decidedByRoles)
      ? evidence.decidedByRoles.filter((r): r is string => typeof r === 'string')
      : [],
    note: closing?.note ?? null,
    competitor: typeof payload.competitor === 'string' ? payload.competitor : null,
  };
}

function handoffDto(
  row: HandoffRecordRow,
  settings: OutcomeSettings,
  workflow: WorkflowConfig,
  names: Map<string, string>,
): HandoffRecord {
  const evidence = acceptanceEvidenceOptions(workflow).find(
    (o) => o.code === row.acceptanceEvidence,
  );
  return {
    acceptanceEvidence: row.acceptanceEvidence as HandoffRecord['acceptanceEvidence'],
    acceptanceEvidenceLabel: evidence?.label ?? row.acceptanceEvidence,
    acceptanceDate: row.acceptanceDate,
    acceptanceDocumentUrl: row.acceptanceDocumentUrl,
    cerId: row.cerId,
    cerStatus: row.cerStatus as HandoffValues['cerStatus'],
    cerApprovedOn: row.cerApprovedOn,
    receivingRole: row.receivingRole,
    receivingRoleLabel: row.receivingRole
      ? (settings.receivingRoles.find((r) => r.code === row.receivingRole)?.label ??
        row.receivingRole)
      : null,
    receivingRoleOther: row.receivingRoleOther,
    receivingContactName: row.receivingContactName,
    acceptedOn: row.acceptedOn,
    notes: row.notes,
    completed: row.completedAt !== null,
    completedAt: iso(row.completedAt),
    completedByName: row.completedBy ? (names.get(row.completedBy) ?? null) : null,
    cerReady: row.cerReadyAt !== null,
    cerReadyAt: iso(row.cerReadyAt),
    cerReadyByName: row.cerReadyBy ? (names.get(row.cerReadyBy) ?? null) : null,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: names.get(row.updatedBy ?? row.createdBy ?? '') ?? null,
  };
}

/**
 * `QuoteDetail.customerDecision` (B-13): the Customer Decision header (proposal issued, validity
 * countdown, SF stage side by side with a mismatch flag), the closure (outcome, reason, owner, date,
 * deciding role) and the Awarded hand-off record. Nothing here is commercial (§3.3): the hand-off holds
 * references, not figures.
 */
export async function customerDecisionView(
  db: DbOrTx,
  input: {
    actor: Actor;
    workflow: WorkflowConfig;
    settings: OutcomeSettings;
    now: Date;
    quote: Quote;
    state: QuoteState;
    sfStage: string | null | undefined;
    decisions: RawDecisions;
  },
): Promise<CustomerDecisionDetail> {
  const { actor, workflow, settings, now, quote: q, state } = input;
  const handoffStage = HANDOFF_STAGE_KEYS.includes(q.stageKey);
  const handoff = handoffStage ? await getHandoffRecord(db, q.id) : undefined;
  // B-26: the latest customer response, when it is a counter within range.
  const latestG5 = [...input.decisions]
    .filter((d) => d.decision.gateKey === 'G5')
    .sort((a, b) => b.decision.decidedAt.getTime() - a.decision.decidedAt.getTime())[0];
  const people = await listUsersByIds(
    db,
    [
      q.closureOwnerId,
      handoff?.completedBy,
      handoff?.cerReadyBy,
      handoff?.updatedBy,
      handoff?.createdBy,
    ].filter((id): id is string => !!id),
  );
  // FB-26 (N17-32): the current CER proof (versioned), once the hand-off exists.
  const proof = handoffStage
    ? (await listCurrentModelVersions(db, [q.id])).find((f) => f.kind === 'cer_proof')
    : undefined;
  const proofBy = proof ? (await listUsersByIds(db, [proof.uploadedBy]))[0] : undefined;
  const names = new Map(people.map((p) => [p.id, p.displayName]));
  const canEditHandoff = handoffStage && can(actor, 'handoff.edit', state);
  return {
    proposalIssuedAt: iso(q.proposalIssuedAt),
    validity: validityDto(q.validityUntil, now, settings),
    validityExpiredFlaggedAt: iso(q.validityExpiredFlaggedAt),
    sf: sfStageDto(workflow, settings, q, input.sfStage),
    closure: closureDto(
      workflow,
      q,
      input.decisions,
      q.closureOwnerId ? (names.get(q.closureOwnerId) ?? null) : null,
    ),
    handoff: handoff ? handoffDto(handoff, settings, workflow, names) : null,
    canEditHandoff,
    inNegotiation:
      q.stageKey === CUSTOMER_DECISION_STAGE_KEY &&
      q.status !== 'closed' &&
      latestG5?.decision.outcomeKey === NEGOTIATING_OUTCOME,
    canAssignClosureOwner: can(actor, 'outcome.assignOwner', state),
    receivingRoles: settings.receivingRoles,
    sfStageByOutcome: settings.sfOutcomeStageNames,
    sfWriteback: await quoteSfWriteback(db, q.id),
    acceptanceEvidenceOptions: acceptanceEvidenceOptions(workflow),
    cer: {
      toolUrl: settings.cerToolUrl || null,
      templateUrl: settings.cerTemplateUrl || null,
      setLinksHint:
        actor.roles.includes('Admin') && (!settings.cerToolUrl || !settings.cerTemplateUrl),
      proof: proof
        ? {
            id: proof.id,
            fileName: proof.fileName,
            version: proof.version,
            uploadedAt: proof.createdAt.toISOString(),
            uploadedByName: proofBy?.displayName ?? null,
          }
        : null,
      proofRequired: settings.cerProofRequired,
      canUploadProof: canEditHandoff,
    },
  };
}

/**
 * FB-29: whether QuoteFlow updates Salesforce for this quote (the write-back switched on and live; live can
 * only be set where this environment has a write connection) and its latest stage write. The KAM's
 * reminder keeps asking for a manual update while this is off, in a dry run included.
 */
async function quoteSfWriteback(db: DbOrTx, quoteId: string): Promise<QuoteSfWriteback> {
  const [enabled, mode, latest] = await Promise.all([
    getSetting(db, SF_WRITEBACK_SETTING_KEYS.enabled),
    getSetting(db, SF_WRITEBACK_SETTING_KEYS.mode),
    latestStageRowForQuote(db, quoteId),
  ]);
  return {
    on: enabled === true && mode === 'live',
    latest: latest
      ? {
          status: latest.status as SfWritebackStatus,
          value: latest.value,
          at: (latest.sentAt ?? latest.updatedAt).toISOString(),
          skippedReason: (latest.skippedReason as SfWritebackSkipReason | null) ?? null,
        }
      : null,
  };
}
