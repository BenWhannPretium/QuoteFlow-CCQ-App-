import { MailError, type MailErrorCode, type MailMessage, type MailTransport } from './contract';
import { buildMime } from './mime';
import type { GraphClient } from '../graph/client';
import { FileStoreError } from '../graph/filestore';

const CODES: Record<string, MailErrorCode> = {
  THROTTLED: 'THROTTLED',
  UNAVAILABLE: 'UNAVAILABLE',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'REJECTED',
};

/**
 * Microsoft Graph `sendMail` from the shared mailbox, app-only (`Mail.Send`, restricted to that one
 * mailbox by an Exchange application access policy). The message goes as MIME (the documented
 * `text/plain` base64 form) so it is a true multipart/alternative with a plain-text part, which
 * Graph's JSON message body cannot express. Not saved to Sent Items: the mailbox is a relay.
 *
 * The client is built with `retries: 0`: the dispatcher owns retries and backoff, and a blind retry
 * inside one attempt could deliver twice.
 */
export class GraphMailTransport implements MailTransport {
  readonly kind = 'graph' as const;

  constructor(
    private readonly client: Pick<GraphClient, 'send'>,
    private readonly mailbox: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const mime = await buildMime({ ...message, from: this.mailbox });
    try {
      await this.client.send({
        method: 'POST',
        path: `/users/${encodeURIComponent(this.mailbox)}/sendMail`,
        headers: { 'content-type': 'text/plain' },
        rawBody: new TextEncoder().encode(mime.toString('base64')),
      });
    } catch (err) {
      if (err instanceof FileStoreError) {
        throw new MailError(CODES[err.code] ?? 'FAILED', err.message, err.status);
      }
      throw new MailError('UNAVAILABLE', 'Microsoft Graph could not be reached');
    }
  }
}
