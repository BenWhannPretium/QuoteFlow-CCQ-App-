import type { MailLogger, MailMessage, MailTransport } from './contract';
import { silentMailLogger } from './contract';

export interface MailGuardOptions {
  /** Shown in the subject, e.g. `TEST` → `[TEST] …`. */
  label: string;
  /** Addresses that receive their own mail (case-insensitive). */
  allow: readonly string[];
  /** Where everyone else's copy goes. Unset = dropped (logged, without the address). */
  redirectTo?: string;
  logger?: MailLogger;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Wraps a transport outside prod (test holds real Salesforce data): only allowlisted recipients get
 * their mail; every other message is redirected to one mailbox with a note naming the intended
 * recipient, or dropped. A dropped message resolves like a sent one, so the outbox doesn't retry it.
 */
export class GuardedMailTransport implements MailTransport {
  private readonly allow: Set<string>;
  private readonly logger: MailLogger;

  constructor(
    private readonly inner: MailTransport,
    private readonly options: MailGuardOptions,
  ) {
    this.allow = new Set(options.allow.map((a) => a.trim().toLowerCase()));
    this.logger = options.logger ?? silentMailLogger;
  }

  get kind() {
    return this.inner.kind;
  }

  async send(message: MailMessage): Promise<void> {
    const label = this.options.label;
    if (this.allow.has(message.to.trim().toLowerCase())) {
      return this.inner.send({ ...message, subject: `[${label}] ${message.subject}` });
    }
    const redirectTo = this.options.redirectTo;
    if (!redirectTo) {
      this.logger.info(
        { guard: label, outcome: 'dropped' },
        'mail guard: recipient not allowlisted',
      );
      return;
    }
    const note = `${label} copy: this message was addressed to ${message.to}.`;
    this.logger.info(
      { guard: label, outcome: 'redirected' },
      'mail guard: recipient not allowlisted',
    );
    return this.inner.send({
      ...message,
      to: redirectTo,
      subject: `[${label} → ${message.to}] ${message.subject}`,
      text: `${note}\n\n${message.text}`,
      html: `<p><strong>${escapeHtml(note)}</strong></p>\n${message.html}`,
    });
  }
}
