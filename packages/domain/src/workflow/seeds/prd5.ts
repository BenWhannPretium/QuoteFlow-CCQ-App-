import type { WorkflowConfig, WorkflowConfigInput } from '../../types/workflow-config';
import { parseWorkflowConfig } from '../validate-config';
import { SEED_REASON_CODES } from './reason-codes';

/**
 * PRD v1's five stages, as a second preset: Intake → Engineering Review → Quoting → Final Review → Awarded / Closed Lost.
 * Final Review records the customer result here (the conflation the hybrid model fixes), with its own gate keys.
 * It exists to prove the engine is config-driven: same code, different workflow. All provisional.
 */
export const prd5Config: WorkflowConfig = parseWorkflowConfig({
  stages: [
    { key: 'INTAKE', label: 'Intake', ownerRole: 'KAM', terminal: false, provisional: true },
    {
      key: 'ENG_REVIEW',
      label: 'Engineering Review',
      ownerRole: 'EngLead',
      terminal: false,
      provisional: true,
    },
    { key: 'QUOTING', label: 'Quoting', ownerRole: 'Pricing', terminal: false, provisional: true },
    {
      key: 'FINAL_REVIEW',
      label: 'Final Review',
      ownerRole: 'Approver',
      terminal: false,
      provisional: true,
    },
    { key: 'AWARDED', label: 'Awarded', terminal: true, provisional: true },
    { key: 'CLOSED_LOST', label: 'Closed Lost', terminal: true, provisional: true },
  ],
  gates: [
    {
      key: 'P_INTAKE',
      stageKey: 'INTAKE',
      label: 'Submit',
      deciderPermission: 'quote.create',
      provisional: true,
    },
    {
      key: 'P_ENG',
      stageKey: 'ENG_REVIEW',
      label: 'Engineering review',
      deciderPermission: 'gate.G2.decide',
      provisional: true,
    },
    {
      key: 'P_QUOTE',
      stageKey: 'QUOTING',
      label: 'Quote',
      deciderPermission: 'gate.G3.submit',
      provisional: true,
    },
    {
      key: 'P_FINAL',
      stageKey: 'FINAL_REVIEW',
      label: 'Final review',
      deciderPermission: 'gate.G4.decide',
      provisional: true,
    },
  ],
  outcomes: [
    {
      gateKey: 'P_INTAKE',
      key: 'submit',
      label: 'Submit',
      requiredFields: [{ field: 'sf_opportunity_id', op: 'present' }],
      provisional: true,
    },
    { gateKey: 'P_ENG', key: 'accept', label: 'Accept', provisional: true },
    {
      gateKey: 'P_ENG',
      key: 'return',
      label: 'Return to KAM',
      requiresNote: true,
      provisional: true,
    },
    { gateKey: 'P_QUOTE', key: 'submit', label: 'Submit to Final Review', provisional: true },
    {
      gateKey: 'P_QUOTE',
      key: 'return',
      label: 'Return to Engineering',
      requiresNote: true,
      provisional: true,
    },
    // B-13 (CR-39): every closure records a reason; for an award it is the acceptance evidence.
    {
      gateKey: 'P_FINAL',
      key: 'award',
      label: 'Awarded',
      requiresReasonCode: true,
      reasonContext: 'awarded',
      provisional: true,
    },
    {
      gateKey: 'P_FINAL',
      key: 'lose',
      label: 'Closed lost',
      requiresReasonCode: true,
      reasonContext: 'lost',
      provisional: true,
    },
    {
      gateKey: 'P_FINAL',
      key: 'return',
      label: 'Return to Quoting',
      requiresNote: true,
      provisional: true,
    },
  ],
  transitions: [
    {
      gateKey: 'P_INTAKE',
      outcomeKey: 'submit',
      targetStageKeys: ['ENG_REVIEW'],
      nextStatus: 'active',
      provisional: true,
    },
    {
      gateKey: 'P_ENG',
      outcomeKey: 'accept',
      targetStageKeys: ['QUOTING'],
      nextStatus: 'active',
      provisional: true,
    },
    {
      gateKey: 'P_ENG',
      outcomeKey: 'return',
      targetStageKeys: ['INTAKE'],
      nextStatus: 'active',
      versionBump: true,
      provisional: true,
    },
    {
      gateKey: 'P_QUOTE',
      outcomeKey: 'submit',
      targetStageKeys: ['FINAL_REVIEW'],
      nextStatus: 'active',
      provisional: true,
    },
    {
      gateKey: 'P_QUOTE',
      outcomeKey: 'return',
      targetStageKeys: ['ENG_REVIEW'],
      nextStatus: 'active',
      versionBump: true,
      provisional: true,
    },
    {
      gateKey: 'P_FINAL',
      outcomeKey: 'award',
      targetStageKeys: ['AWARDED'],
      nextStatus: 'closed',
      closeAs: 'awarded',
      provisional: true,
    },
    {
      gateKey: 'P_FINAL',
      outcomeKey: 'lose',
      targetStageKeys: ['CLOSED_LOST'],
      nextStatus: 'closed',
      closeAs: 'lost',
      provisional: true,
    },
    {
      gateKey: 'P_FINAL',
      outcomeKey: 'return',
      targetStageKeys: ['QUOTING'],
      nextStatus: 'active',
      versionBump: true,
      provisional: true,
    },
  ],
  reasonCodes: SEED_REASON_CODES,
  segregation: [
    {
      id: 'final-kam-cannot-decide-own',
      gateKeys: ['P_FINAL'],
      deny: 'actor_is_kam',
      message: 'You cannot decide Final Review on a quote where you are the KAM',
      provisional: true,
    },
  ],
} satisfies WorkflowConfigInput);
