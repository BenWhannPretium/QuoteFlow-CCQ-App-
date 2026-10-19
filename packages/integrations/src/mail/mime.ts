import MailComposer from 'nodemailer/lib/mail-composer';

import type { MailMessage } from './contract';

/**
 * Headers for a system mailbox nobody reads: auto-responders (out-of-office, read receipts) must not
 * answer it, and mail clients can tell it is machine-generated.
 */
export const AUTOMATED_HEADERS = {
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'All',
} as const;

export const toMailOptions = (m: MailMessage) => ({
  from: m.from,
  to: m.to,
  subject: m.subject,
  text: m.text,
  html: m.html,
  headers: { ...AUTOMATED_HEADERS },
});

/** The message as RFC 5322 MIME (multipart/alternative: plain text, then HTML). */
export function buildMime(message: MailMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    new MailComposer(toMailOptions(message)).compile().build((err, mime) => {
      if (err) reject(err);
      else resolve(mime);
    });
  });
}
