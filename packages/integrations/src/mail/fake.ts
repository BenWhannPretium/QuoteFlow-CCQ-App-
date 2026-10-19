import type { MailMessage, MailTransport } from './contract';
import { MailError } from './contract';

/**
 * An in-memory transport: tests read `sent`; local dev without mailpit gets the same behaviour and a
 * log line from the dispatcher. `failWith` makes the next sends fail (retry and owner-alert tests).
 */
export class FakeMailTransport implements MailTransport {
  readonly kind = 'fake' as const;
  readonly sent: MailMessage[] = [];
  private failures: MailError[] = [];
  private failAll: MailError | null = null;

  /** Fail the next `times` sends with `error`. */
  failNext(times: number, error: MailError = new MailError('UNAVAILABLE', 'fake outage', 503)) {
    this.failures = Array.from({ length: times }, () => error);
  }

  /** Fail every send until `recover()`. */
  failAlways(error: MailError = new MailError('UNAVAILABLE', 'fake outage', 503)) {
    this.failAll = error;
  }

  recover() {
    this.failAll = null;
    this.failures = [];
  }

  async send(message: MailMessage): Promise<void> {
    const failure = this.failAll ?? this.failures.shift();
    if (failure) throw failure;
    this.sent.push(message);
  }
}
