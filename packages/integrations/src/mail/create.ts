import type { MailTransport } from './contract';
import { FakeMailTransport } from './fake';
import { GraphMailTransport } from './graph';
import { SmtpMailTransport } from './smtp';
import { createGraphCredential, GraphClient, type GraphCredentialConfig } from '../graph/client';
import type { FileStoreLogger } from '../graph/filestore';

/** `MAIL_MODE`: `graph` (production), `smtp` (mailpit) or `fake` (tests and quiet local dev). */
export type MailConfig =
  | { mode: 'graph'; mailbox: string; credential: GraphCredentialConfig }
  | { mode: 'smtp'; host: string; port: number }
  | { mode: 'fake' };

export function createMailTransport(
  config: MailConfig,
  options: { logger?: FileStoreLogger } = {},
): MailTransport {
  switch (config.mode) {
    case 'graph':
      return new GraphMailTransport(
        new GraphClient({
          credential: createGraphCredential(config.credential),
          retries: 0,
          ...options,
        }),
        config.mailbox,
      );
    case 'smtp':
      return new SmtpMailTransport({ host: config.host, port: config.port });
    case 'fake':
      return new FakeMailTransport();
  }
}
