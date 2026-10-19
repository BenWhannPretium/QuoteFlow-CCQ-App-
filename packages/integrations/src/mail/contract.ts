/**
 * Outbound mail (B-18). One interface, three implementations: Microsoft Graph from the shared mailbox
 * (production), SMTP to mailpit (local dev) and an in-memory fake (tests, and local dev without
 * mailpit). Switching is `MAIL_MODE` only.
 */

export interface MailMessage {
  /** The shared mailbox, e.g. ccq-noreply@pretiumpkg.com. Graph sends as this mailbox. */
  from: string;
  to: string;
  subject: string;
  html: string;
  /** The plain-text alternative. Every message has both parts. */
  text: string;
}

export type MailErrorCode =
  /** 429: try again later. */
  | 'THROTTLED'
  /** 5xx or the network: try again later. */
  | 'UNAVAILABLE'
  /** 401/403: the credential or the Exchange application access policy refuses. Config, not transient. */
  | 'FORBIDDEN'
  /** 4xx: the message itself was refused (bad address, mailbox not found). */
  | 'REJECTED'
  | 'FAILED';

/** A send failure. The message is data-free (a status and a code), safe to store and log. */
export class MailError extends Error {
  constructor(
    public readonly code: MailErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

export interface MailTransport {
  readonly kind: 'graph' | 'smtp' | 'fake';
  /** Resolves once the message is accepted for delivery; throws `MailError` otherwise. */
  send(message: MailMessage): Promise<void>;
}

export interface MailLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const silentMailLogger: MailLogger = { info() {}, warn() {}, error() {} };
