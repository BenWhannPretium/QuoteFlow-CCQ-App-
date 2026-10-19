import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { AccessToken, TokenCredential } from '@azure/identity';

import { BlobConflictError, type BlobContainer } from './blob';
import type { FetchLike } from './client';
import { FileStoreError } from './filestore';

/**
 * Test doubles for the graph/ stores: an in-memory SharePoint drive behind a fake `fetch`, and an
 * in-memory blob container. Not used at runtime.
 */

export const fakeCredential = (): TokenCredential & { calls: number } => {
  const cred = {
    calls: 0,
    getToken(): Promise<AccessToken> {
      cred.calls++;
      return Promise.resolve({ token: 'test-token', expiresOnTimestamp: Date.now() + 3_600_000 });
    },
  };
  return cred;
};

interface MockItem {
  id: string;
  name: string;
  parentId: string | null;
  folder: boolean;
  size: number;
  /** Kept only when `keepBytes` (contract tests read back small files). */
  bytes: Buffer | null;
  sha256: string;
}

interface Session {
  parentId: string;
  name: string;
  total: number | null;
  received: number;
  hash: ReturnType<typeof createHash>;
  parts: Buffer[] | null;
}

const RANGE_UNIT = 320 * 1024;
const BASE = 'https://graph.microsoft.com/v1.0';

/**
 * A SharePoint document library as Graph shows it, enough for SharePointFileStore: path and id
 * addressing, folder creation (conflictBehavior fail), upload sessions with Content-Range checks
 * (order, 320 KiB multiples, constant total), moves with rename, children paging, download URLs.
 */
export class MockGraphDrive {
  readonly driveId = 'b!mock-drive';
  readonly items = new Map<string, MockItem>();
  readonly sessions = new Map<string, Session>();
  readonly requests: { method: string; url: string; auth: boolean; contentRange?: string }[] = [];
  /** Fail the next N requests matching a predicate with a status (throttling / outage tests). */
  failures: { match: (method: string, url: string) => boolean; status: number; times: number }[] =
    [];
  private readonly rootId = 'root-id';

  constructor(private readonly opts: { keepBytes?: boolean; pageSize?: number } = {}) {
    this.items.set(this.rootId, {
      id: this.rootId,
      name: 'root',
      parentId: null,
      folder: true,
      size: 0,
      bytes: null,
      sha256: '',
    });
  }

  readonly fetch: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    this.requests.push({
      method,
      url,
      auth: Boolean(headers.authorization),
      ...(headers['content-range'] ? { contentRange: headers['content-range'] } : {}),
    });
    const fail = this.failures.find((f) => f.times > 0 && f.match(method, url));
    if (fail) {
      fail.times--;
      return json(fail.status, { error: { code: 'injected' } });
    }
    try {
      return await this.route(method, url, headers, init.body);
    } catch (err) {
      if (err instanceof MockHttpError) return json(err.status, { error: { code: err.code } });
      throw err;
    }
  };

  private pathOf(id: string): string {
    const parts: string[] = [];
    let cur = this.items.get(id);
    while (cur && cur.parentId !== null) {
      parts.unshift(cur.name);
      cur = this.items.get(cur.parentId);
    }
    return parts.join('/');
  }

  private child(parentId: string, name: string) {
    return [...this.items.values()].find(
      (i) => i.parentId === parentId && i.name.toLowerCase() === name.toLowerCase(),
    );
  }

  private byPath(path: string): MockItem | undefined {
    let cur = this.items.get(this.rootId)!;
    for (const seg of path.split('/').filter(Boolean)) {
      const next = this.child(cur.id, decodeURIComponent(seg));
      if (!next) return undefined;
      cur = next;
    }
    return cur;
  }

  private freeName(parentId: string, name: string): string {
    for (let n = 0; ; n++) {
      const dot = name.lastIndexOf('.');
      const candidate =
        n === 0 ? name : dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
      if (!this.child(parentId, candidate)) return candidate;
    }
  }

  private dto(item: MockItem) {
    return {
      id: item.id,
      name: item.name,
      size: item.size,
      webUrl: `https://contoso.sharepoint.com/sites/ccq/Shared%20Documents/${this.pathOf(item.id)
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      ...(item.folder ? { folder: { childCount: 0 } } : { file: { mimeType: 'x' } }),
      parentReference: {
        id: item.parentId,
        path: `/drives/${this.driveId}/root:${item.parentId === this.rootId ? '' : `/${this.pathOf(item.parentId!)}`}`,
      },
      '@microsoft.graph.downloadUrl': `https://download.mock/${item.id}?sig=abc`,
    };
  }

  /** The bytes of a stored file (keepBytes) for read-back assertions. */
  content(itemId: string): Buffer | null {
    return this.items.get(itemId)?.bytes ?? null;
  }

  private async route(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response> {
    if (url.startsWith('https://upload.mock/')) return this.uploadPart(method, url, headers, body);
    if (!headers.authorization) throw new MockHttpError(401, 'unauthenticated');
    const u = new URL(url);
    if (!url.startsWith(BASE)) throw new MockHttpError(400, 'badUrl');
    const path = u.pathname.slice('/v1.0'.length);
    const drive = `/drives/${this.driveId}`;
    if (!path.startsWith(drive)) throw new MockHttpError(404, 'driveNotFound');
    const rest = path.slice(drive.length);
    const reqBody = typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {};

    // /root:/a/b:  /root:/a/b:/children  /root:/a/b:/createUploadSession  /root/children
    const m = /^\/root:\/(.+?):(\/children|\/createUploadSession)?$/.exec(rest);
    if (m) {
      const p = m[1]!;
      if (m[2] === '/createUploadSession' && method === 'POST') {
        const slash = p.lastIndexOf('/');
        const parent = this.byPath(p.slice(0, Math.max(slash, 0)));
        if (!parent?.folder) throw new MockHttpError(404, 'itemNotFound');
        const id = randomUUID();
        this.sessions.set(id, {
          parentId: parent.id,
          name: decodeURIComponent(p.slice(slash + 1)),
          total: null,
          received: 0,
          hash: createHash('sha256'),
          parts: this.opts.keepBytes ? [] : null,
        });
        return json(200, { uploadUrl: `https://upload.mock/${id}`, expirationDateTime: 'x' });
      }
      const item = this.byPath(p);
      if (!item) throw new MockHttpError(404, 'itemNotFound');
      if (m[2] === '/children' && method === 'POST') return this.createFolder(item, reqBody);
      if (m[2] === '/children' && method === 'GET') return this.children(item, u);
      if (!m[2] && method === 'GET') return json(200, this.dto(item));
    }
    if (rest === '/root/children' && method === 'POST') {
      return this.createFolder(this.items.get(this.rootId)!, reqBody);
    }
    const byId = /^\/items\/([^/]+)$/.exec(rest);
    if (byId) {
      const item = this.items.get(decodeURIComponent(byId[1]!));
      if (!item) throw new MockHttpError(404, 'itemNotFound');
      if (method === 'GET') return json(200, this.dto(item));
      if (method === 'PATCH') {
        const parentId = (reqBody.parentReference as { id?: string } | undefined)?.id;
        const parent = parentId ? this.items.get(parentId) : undefined;
        if (!parent?.folder) throw new MockHttpError(400, 'invalidRequest');
        const rename = u.searchParams.get('@microsoft.graph.conflictBehavior') === 'rename';
        if (this.child(parent.id, item.name) && !rename)
          throw new MockHttpError(409, 'nameAlreadyExists');
        item.name = this.freeName(parent.id, item.name);
        item.parentId = parent.id;
        return json(200, this.dto(item));
      }
    }
    throw new MockHttpError(400, 'unsupported');
  }

  private createFolder(parent: MockItem, body: Record<string, unknown>) {
    const name = String(body.name);
    if (this.child(parent.id, name)) throw new MockHttpError(409, 'nameAlreadyExists');
    const item: MockItem = {
      id: randomUUID(),
      name,
      parentId: parent.id,
      folder: true,
      size: 0,
      bytes: null,
      sha256: '',
    };
    this.items.set(item.id, item);
    return json(201, this.dto(item));
  }

  private children(parent: MockItem, u: URL) {
    const all = [...this.items.values()]
      .filter((i) => i.parentId === parent.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    const size = this.opts.pageSize ?? 200;
    const skip = Number(u.searchParams.get('$skiptoken') ?? 0);
    const page = all.slice(skip, skip + size);
    const next = skip + size < all.length ? new URL(u) : null;
    next?.searchParams.set('$skiptoken', String(skip + size));
    return json(200, {
      value: page.map((i) => this.dto(i)),
      ...(next ? { '@odata.nextLink': next.toString() } : {}),
    });
  }

  private uploadPart(method: string, url: string, headers: Record<string, string>, body: unknown) {
    if (headers.authorization) throw new MockHttpError(400, 'bearerSentToUploadUrl');
    const id = url.slice('https://upload.mock/'.length);
    const s = this.sessions.get(id);
    if (!s) throw new MockHttpError(404, 'uploadSessionNotFound');
    if (method === 'DELETE') {
      this.sessions.delete(id);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '');
    if (!m) throw new MockHttpError(400, 'invalidRange');
    const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const buf = Buffer.from(body as Uint8Array);
    if (s.total !== null && s.total !== total) throw new MockHttpError(400, 'totalChanged');
    if (start !== s.received || end - start + 1 !== buf.length)
      throw new MockHttpError(416, 'outOfOrder');
    if (end + 1 < total && buf.length % RANGE_UNIT !== 0)
      throw new MockHttpError(400, 'notMultipleOf320KiB');
    s.total = total;
    s.received = end + 1;
    s.hash.update(buf);
    s.parts?.push(buf);
    if (s.received < total) {
      return Promise.resolve(json(202, { nextExpectedRanges: [`${s.received}-`] }));
    }
    this.sessions.delete(id);
    const item: MockItem = {
      id: randomUUID(),
      name: this.freeName(s.parentId, s.name),
      parentId: s.parentId,
      folder: false,
      size: total,
      bytes: s.parts ? Buffer.concat(s.parts) : null,
      sha256: s.hash.digest('hex'),
    };
    this.items.set(item.id, item);
    return Promise.resolve(json(201, this.dto(item)));
  }
}

class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An in-memory private container (BlobFileStore's contract tests). */
export class MemoryBlobContainer implements BlobContainer {
  readonly blobs = new Map<string, { bytes: Buffer; contentType: string }>();

  exists(name: string) {
    return Promise.resolve(this.blobs.has(name));
  }

  async upload(name: string, stream: Readable, contentType: string) {
    if (this.blobs.has(name)) throw new BlobConflictError('exists');
    const parts: Buffer[] = [];
    for await (const p of stream as AsyncIterable<Buffer>) parts.push(Buffer.from(p));
    // Committed only when the whole stream succeeded (like a block list commit).
    this.blobs.set(name, { bytes: Buffer.concat(parts), contentType });
  }

  size(name: string) {
    return Promise.resolve(this.blobs.get(name)?.bytes.length ?? null);
  }

  list(prefix: string) {
    return Promise.resolve(
      [...this.blobs.entries()]
        .filter(([n]) => n.startsWith(`${prefix}/`) && !n.slice(prefix.length + 1).includes('/'))
        .map(([name, b]) => ({ name, size: b.bytes.length })),
    );
  }

  copy(from: string, to: string) {
    const src = this.blobs.get(from);
    if (!src) return Promise.reject(new FileStoreError('NOT_FOUND', 'missing', 404));
    if (this.blobs.has(to)) return Promise.reject(new BlobConflictError('exists'));
    this.blobs.set(to, { ...src });
    return Promise.resolve();
  }

  delete(name: string) {
    if (!this.blobs.delete(name))
      return Promise.reject(new FileStoreError('NOT_FOUND', 'missing', 404));
    return Promise.resolve();
  }

  readUrl(name: string, expiresOn: Date, fileName: string, contentType: string) {
    const q = new URLSearchParams({
      se: expiresOn.toISOString(),
      sp: 'r',
      rscd: `attachment; filename="${fileName}"`,
      rsct: contentType,
    });
    return Promise.resolve(
      `https://acct.blob.core.windows.net/ccq/${encodeURI(name)}?${q.toString()}`,
    );
  }
}
