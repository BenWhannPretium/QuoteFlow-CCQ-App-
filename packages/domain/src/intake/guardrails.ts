import { z } from 'zod';

/**
 * FB-10 (F-066, T-025, D-004 open): the platform-minimum guardrail. A quote whose annual volume is below the
 * new-mold planning minimum of a machine platform gets a WARNING on the intake ("You can still submit") and
 * the warning is recorded on the quote for G1. It never blocks. Config: app_setting `intake_guardrails`,
 * seeded OFF. The minimums are Danielle Leu's corrected table (reply of 2026-11-09 to "please confirm our
 * read of the Machine Platforms guide"; `docs/build-guide/feedback/inputs/platform-guide.md`). An Admin
 * switches the warning on once D-004 agrees to warn at these volumes.
 *
 * The intake has no platform field (Engineering picks the process type later), so while the platform is not
 * known the minimum is the LOWEST platform minimum: a quote under it is under every platform's minimum.
 * When a platform is known (`process_type`), its own minimum applies.
 */

export const intakeGuardrailsSchema = z
  .object({
    enabled: z.boolean(),
    /** `process_type` code → minimum program, units per year (planning minimum for a new mold). */
    minAnnualVolumeByProcess: z.record(z.string().min(1), z.number().int().positive()),
    /** Replaces {platform} in the message while the platform is not known. */
    unknownPlatformLabel: z.string().trim().min(1).max(80),
    /** {platform}, {units} (the quote's volume) and {minimum} are replaced. */
    message: z.string().trim().min(1).max(300),
  })
  .strict();
export type IntakeGuardrails = z.infer<typeof intakeGuardrailsSchema>;

/**
 * Seed (provisional, OFF): Danielle Leu's corrected platform table (2026-11-09). FB-10 had read the PDF
 * with ISBM at 3M and Injection (IMM) at 1M; Danielle's correction swaps them (ISBM 1M, IMM 3M).
 */
export const INTAKE_GUARDRAILS_SEED: IntakeGuardrails = {
  enabled: false,
  minAnnualVolumeByProcess: {
    ISBM: 1_000_000,
    RHB: 1_000_000,
    IMM: 3_000_000,
    IBM: 3_000_000,
    EBM: 1_000_000,
  },
  unknownPlatformLabel: 'our machine platforms',
  message: 'Below the platform minimum for {platform}: {units} units/yr. You can still submit.',
};

/** The setting as it behaves when absent or malformed: off. */
export const INTAKE_GUARDRAILS_OFF: IntakeGuardrails = {
  ...INTAKE_GUARDRAILS_SEED,
  enabled: false,
};

/** Reads the setting (untrusted JSON); anything malformed switches the guardrail off. */
export function parseIntakeGuardrails(value: unknown): IntakeGuardrails {
  const parsed = intakeGuardrailsSchema.safeParse(value);
  return parsed.success ? parsed.data : INTAKE_GUARDRAILS_OFF;
}

export interface GuardrailWarning {
  code: 'BELOW_PLATFORM_MINIMUM';
  field: 'est_annual_volume';
  message: string;
  minimum: number;
  platform: string | null;
}

const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function guardrailWarning(
  guardrails: IntakeGuardrails,
  input: { volume: unknown; processType?: unknown },
): GuardrailWarning | null {
  if (!guardrails.enabled) return null;
  const volume = typeof input.volume === 'number' ? input.volume : null;
  if (volume === null || !Number.isFinite(volume) || volume <= 0) return null;

  const minimums = guardrails.minAnnualVolumeByProcess;
  const process =
    typeof input.processType === 'string' && input.processType in minimums
      ? input.processType
      : null;
  const all = Object.values(minimums);
  const minimum = process !== null ? minimums[process]! : all.length ? Math.min(...all) : null;
  if (minimum === null || volume >= minimum) return null;

  const platform = process;
  return {
    code: 'BELOW_PLATFORM_MINIMUM',
    field: 'est_annual_volume',
    minimum,
    platform,
    message: guardrails.message
      .replaceAll('{platform}', platform ?? guardrails.unknownPlatformLabel)
      .replaceAll('{units}', num.format(volume))
      .replaceAll('{minimum}', num.format(minimum)),
  };
}
