import { createTransport, type Transporter } from 'nodemailer';

import { MailError, type MailMessage, type MailTransport } from './contract';
import { toMailOptions } from './mime';

export interface SmtpMailOptions {
  host: string;
  port: number;
}

/** Plain SMTP, no auth, no TLS: mailpit on localhost (`docker compose up -d mailpit`, UI :8025). */
export class SmtpMailTransport implements MailTransport {
  readonly kind = 'smtp' as const;
  private readonly transporter: Transporter;

  constructor(opts: SmtpMailOptions) {
    this.transporter = createTransport({
      host: opts.host,
      port: opts.port,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 15_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail(toMailOptions(message));
    } catch (err) {
      const status = (err as { responseCode?: number }).responseCode;
      throw new MailError(
        status && status >= 400 && status < 500 ? 'REJECTED' : 'UNAVAILABLE',
        `SMTP send failed${status ? ` (${status})` : ''}`,
        status,
      );
    }
  }

  close() {
    this.transporter.close();
  }
}
