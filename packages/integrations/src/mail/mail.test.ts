import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FakeMailTransport,
  GraphMailTransport,
  MailError,
  SmtpMailTransport,
  buildMime,
  createMailTransport,
  type MailMessage,
} from './index';
import { GraphClient } from '../graph/client';
import { fakeCredential } from '../graph/testing';

const MESSAGE: MailMessage = {
  from: 'ccq-noreply@pretiumpkg.com',
  to: 'jim@pretiumpkg.com',
  subject: '[QuoteFlow] CCQ-2026-00042 needs your review: Engineering queue',
  html: '<p>Open <a href="https://ccq.example/quotes/CCQ-2026-00042">CCQ-2026-00042</a> — café</p>',
  text: 'Open https://ccq.example/quotes/CCQ-2026-00042 — café',
};

describe('buildMime', () => {
  it('is multipart/alternative with a plain-text and an HTML part and automation headers', async () => {
    const mime = (await buildMime(MESSAGE)).toString('utf8');
    expect(mime).toMatch(/Content-Type: multipart\/alternative/i);
    expect(mime).toMatch(/Content-Type: text\/plain/i);
    expect(mime).toMatch(/Content-Type: text\/html/i);
    expect(mime).toMatch(/^Auto-Submitted: auto-generated/im);
    expect(mime).toMatch(/^X-Auto-Response-Suppress: All/im);
    expect(mime).toMatch(/^To: jim@pretiumpkg\.com/im);
    expect(mime.indexOf('text/plain')).toBeLessThan(mime.indexOf('text/html'));
  });
});

describe('GraphMailTransport', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const clientWith = (respond: () => Response) =>
    new GraphClient({
      credential: fakeCredential(),
      retries: 0,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return respond();
      },
    });

  afterEach(() => {
    calls.length = 0;
  });

  it('POSTs base64 MIME as text/plain to /users/{mailbox}/sendMail, sending as the mailbox', async () => {
    const transport = new GraphMailTransport(
      clientWith(() => new Response(null, { status: 202 })),
      'ccq-noreply@pretiumpkg.com',
    );
    await transport.send({ ...MESSAGE, from: 'someone-else@pretiumpkg.com' });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      'https://graph.microsoft.com/v1.0/users/ccq-noreply%40pretiumpkg.com/sendMail',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('text/plain');
    const mime = Buffer.from(
      Buffer.from(init.body as Uint8Array).toString('utf8'),
      'base64',
    ).toString('utf8');
    expect(mime).toMatch(/^From: ccq-noreply@pretiumpkg\.com/im);
    expect(mime).not.toMatch(/someone-else/);
    expect(mime).toMatch(/multipart\/alternative/i);
  });

  it.each([
    [429, 'THROTTLED'],
    [503, 'UNAVAILABLE'],
    [403, 'FORBIDDEN'],
    [404, 'REJECTED'],
    [400, 'FAILED'],
  ])('maps a %i answer to %s', async (status, code) => {
    const transport = new GraphMailTransport(
      clientWith(() => new Response(JSON.stringify({ error: { code: 'x' } }), { status })),
      'ccq-noreply@pretiumpkg.com',
    );
    await expect(transport.send(MESSAGE)).rejects.toMatchObject({ name: 'MailError', code });
  });

  it('never puts the message in the error', async () => {
    const transport = new GraphMailTransport(
      clientWith(() => new Response('{}', { status: 400 })),
      'ccq-noreply@pretiumpkg.com',
    );
    const err = (await transport.send(MESSAGE).catch((e: unknown) => e)) as MailError;
    expect(err.message).not.toContain('CCQ-2026-00042');
    expect(err.message).not.toContain('jim@');
  });
});

describe('FakeMailTransport', () => {
  it('records sends and fails on demand', async () => {
    const fake = new FakeMailTransport();
    await fake.send(MESSAGE);
    fake.failNext(1);
    await expect(fake.send(MESSAGE)).rejects.toBeInstanceOf(MailError);
    await fake.send(MESSAGE);
    expect(fake.sent).toHaveLength(2);
    fake.failAlways();
    await expect(fake.send(MESSAGE)).rejects.toBeInstanceOf(MailError);
    fake.recover();
    await fake.send(MESSAGE);
    expect(fake.sent).toHaveLength(3);
  });
});

/** Just enough SMTP to accept one message and keep what was sent. */
function smtpSink(): Promise<{ server: Server; port: number; received: string[] }> {
  const received: string[] = [];
  const server = createServer((socket) => {
    let data = '';
    let inData = false;
    socket.write('220 sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      let text = chunk.toString('utf8');
      if (inData) {
        data += text;
        if (data.endsWith('\r\n.\r\n')) {
          received.push(data.slice(0, -5));
          data = '';
          inData = false;
          socket.write('250 queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-sink\r\n250 8BITMIME\r\n');
        else if (cmd === 'MAIL' || cmd === 'RCPT') socket.write('250 ok\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
      text = '';
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        received,
      });
    }),
  );
}

describe('SmtpMailTransport (mailpit stand-in)', () => {
  it('delivers a multipart message over plain SMTP', async () => {
    const { server, port, received } = await smtpSink();
    const transport = new SmtpMailTransport({ host: '127.0.0.1', port });
    try {
      await transport.send(MESSAGE);
    } finally {
      transport.close();
      server.close();
    }
    expect(received).toHaveLength(1);
    expect(received[0]).toMatch(/Subject: \[QuoteFlow\] CCQ-2026-00042/);
    expect(received[0]).toMatch(/multipart\/alternative/i);
  });

  it('reports an unreachable server as UNAVAILABLE', async () => {
    const transport = new SmtpMailTransport({ host: '127.0.0.1', port: 1 });
    await expect(transport.send(MESSAGE)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    transport.close();
  });
});

describe('createMailTransport', () => {
  it('builds the transport for each mode', () => {
    expect(createMailTransport({ mode: 'fake' }).kind).toBe('fake');
    const smtp = createMailTransport({ mode: 'smtp', host: 'localhost', port: 1025 });
    expect(smtp.kind).toBe('smtp');
    (smtp as SmtpMailTransport).close();
    expect(
      createMailTransport({
        mode: 'graph',
        mailbox: 'ccq-noreply@pretiumpkg.com',
        credential: { kind: 'managed-identity' },
      }).kind,
    ).toBe('graph');
  });
});
