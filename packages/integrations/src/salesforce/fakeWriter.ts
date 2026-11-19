import { isWritableSfField } from './writeMap';
import { SF_ID, type SalesforceWriter, type SfStageResult, type SfWriteResult } from './writer';

/** One call the fake writer received. */
export interface FakeWriteCall {
  sfOpportunityId: string;
  fields: Record<string, string>;
  dedupeKey: string;
  /** What the fake answered. */
  result: SfWriteResult;
}

/** An injected failure: `timeout` reaches "Salesforce" (the value is stored) yet reports a retryable error. */
export type FakeWriteFailure =
  { kind: 'error'; retryable: boolean; code?: string; message?: string } | { kind: 'timeout' };

/**
 * FB-29: the fake writer for tests, local dev and the dry runs on the test site (SF_WRITE_MODE=fake).
 * It records every call, keeps an in-memory stage per opportunity, and can be told to fail or time out.
 * Nothing leaves the process. Refused in production (config.ts).
 */
export class FakeSalesforceWriter implements SalesforceWriter {
  readonly mode = 'fake' as const;
  readonly calls: FakeWriteCall[] = [];
  /** Stage reads made (opportunity ids). */
  readonly stageReads: string[] = [];
  private readonly stages = new Map<string, string | null>();
  private readonly failures: FakeWriteFailure[] = [];
  private readonly refusedOnce = new Set<string>();

  /**
   * `failFirstPerOpportunity`: refuse the first update of each opportunity (not retryable, as a Salesforce
   * validation rule would), so an end-to-end test can see a failed row and retry it
   * (`SF_WRITE_FAKE_FAIL_FIRST=1`; the fake is refused in production).
   */
  constructor(private readonly options: { failFirstPerOpportunity?: boolean } = {}) {}

  /** Set the stage the fake opportunity holds (as a sales person would in Salesforce). */
  setStage(sfOpportunityId: string, stage: string | null): void {
    this.stages.set(sfOpportunityId, stage);
  }

  stageOf(sfOpportunityId: string): string | null | undefined {
    return this.stages.get(sfOpportunityId);
  }

  /** Fail the next update calls, in order. */
  failNext(...failures: FakeWriteFailure[]): void {
    this.failures.push(...failures);
  }

  reset(): void {
    this.calls.length = 0;
    this.stageReads.length = 0;
    this.stages.clear();
    this.failures.length = 0;
  }

  updateOpportunity(
    sfOpportunityId: string,
    fields: Readonly<Record<string, string>>,
    options: { dedupeKey: string },
  ): Promise<SfWriteResult> {
    const record = (result: SfWriteResult) => {
      this.calls.push({
        sfOpportunityId,
        fields: { ...fields },
        dedupeKey: options.dedupeKey,
        result,
      });
      return Promise.resolve(result);
    };
    if (!SF_ID.test(sfOpportunityId)) {
      return record({
        ok: false,
        retryable: false,
        code: 'INVALID_ID',
        message: 'not a Salesforce id',
      });
    }
    const refused = Object.keys(fields).filter((f) => !isWritableSfField('Opportunity', f));
    if (refused.length > 0 || Object.keys(fields).length === 0) {
      return record({
        ok: false,
        retryable: false,
        code: 'FIELD_NOT_ALLOWED',
        message: `not on the write allow-list: ${refused.join(', ') || '(no fields)'}`,
      });
    }
    if (this.options.failFirstPerOpportunity && !this.refusedOnce.has(sfOpportunityId)) {
      this.refusedOnce.add(sfOpportunityId);
      return record({
        ok: false,
        retryable: false,
        code: 'FIELD_CUSTOM_VALIDATION_EXCEPTION',
        message: 'Injected failure (fake writer, SF_WRITE_FAKE_FAIL_FIRST)',
      });
    }
    const failure = this.failures.shift();
    if (failure?.kind === 'timeout') {
      if (fields.StageName !== undefined) this.stages.set(sfOpportunityId, fields.StageName);
      return record({
        ok: false,
        retryable: true,
        code: 'TIMEOUT',
        message: 'Salesforce call timed out',
      });
    }
    if (failure) {
      return record({
        ok: false,
        retryable: failure.retryable,
        code:
          failure.code ??
          (failure.retryable ? 'SERVER_UNAVAILABLE' : 'FIELD_CUSTOM_VALIDATION_EXCEPTION'),
        message: failure.message ?? 'injected failure',
      });
    }
    if (fields.StageName !== undefined) this.stages.set(sfOpportunityId, fields.StageName);
    return record({ ok: true });
  }

  getCurrentStage(sfOpportunityId: string): Promise<SfStageResult> {
    this.stageReads.push(sfOpportunityId);
    if (!SF_ID.test(sfOpportunityId)) {
      return Promise.resolve({
        ok: false,
        retryable: false,
        code: 'INVALID_ID',
        message: 'not a Salesforce id',
      });
    }
    return Promise.resolve({ ok: true, stage: this.stages.get(sfOpportunityId) ?? null });
  }
}
