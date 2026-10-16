/**
 * Priority scoring (F-05, B-08). Advisory only: the score orders queues and informs G1; a human decides.
 * Everything business-specific (attributes, weights, bands, tiers) is config: see `model.ts`.
 */
export * from './inputs';
export * from './model';
export * from './qualification';
export * from './score';
export * from './seeds';
export * from './visibility';
