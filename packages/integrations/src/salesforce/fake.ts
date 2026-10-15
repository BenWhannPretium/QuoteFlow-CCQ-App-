import type { SfAccount, SfOpportunity, SfProductSpec } from '@ccq/contracts';

import {
  mapAccount,
  mapOpportunityRecord,
  mapProductSpec,
  stripAttributes,
  timestamp,
  type MapOptions,
} from './mapper';
import {
  searchTerms,
  type SalesforceReader,
  type SearchOpportunitiesParams,
  type SfOpportunityRecord,
} from './reader';

type Raw = Record<string, unknown>;

/**
 * The fixture the fake serves: raw records shaped exactly like SOQL results (relationship fields
 * nested, e.g. `Owner.Email`), so the fake goes through the same mapper as the live reader.
 * `fixtures/synthetic.json` is generated from the B-03 synthetic data (`pnpm db:sf-fixture`).
 */
export interface SfFixture {
  generatedFrom?: Record<string, unknown>;
  opportunities: Raw[];
  accounts: Raw[];
  productSpecs: Raw[];
  deleted: { id: string; deletedDate: string }[];
}

const PAGE_SIZE = 2_000;

/** Character trigrams of a word, padded like pg_trgm. */
function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * How well `term` matches `text`: 1 for a substring, else the best trigram similarity to any word
 * (so "pickel" still finds "Pickle"), else 0.
 */
export function termScore(term: string, text: string): number {
  const haystack = text.toLowerCase();
  if (haystack.includes(term)) return 1;
  let best = 0;
  for (const word of haystack.split(/[^\p{L}\p{N}.-]+/u)) {
    if (word.length < 2) continue;
    best = Math.max(best, similarity(term, word));
  }
  return best >= 0.4 ? best : 0;
}

/**
 * In-memory SalesforceReader over a fixture. Used when `SF_MODE=fake` (local dev and CI) and in tests.
 * Test helpers (`put`, `remove`) simulate changes in SF; there is still no way to write to SF.
 */
export class FakeSalesforceReader implements SalesforceReader {
  readonly mode = 'fake' as const;
  private opportunities = new Map<string, Raw>();
  private readonly accounts = new Map<string, Raw>();
  private readonly specs: Raw[];
  private readonly deleted: { id: string; deletedDate: string }[];
  /** Calls per method, so tests can assert the cache or the snapshot-first search. */
  readonly calls: Record<string, number> = {};
  /** When set, every call rejects with it (to test failure handling). */
  failWith: Error | null = null;

  constructor(
    fixture: SfFixture,
    private readonly options: MapOptions = {},
  ) {
    for (const o of fixture.opportunities) this.opportunities.set(String(o.Id), o);
    for (const a of fixture.accounts) this.accounts.set(String(a.Id), a);
    this.specs = [...fixture.productSpecs];
    this.deleted = [...fixture.deleted];
  }

  private enter(method: string) {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve();
  }

  private record(raw: Raw): SfOpportunityRecord | null {
    return mapOpportunityRecord(raw, this.options);
  }

  async searchOpportunities(p: SearchOpportunitiesParams): Promise<SfOpportunity[]> {
    await this.enter('searchOpportunities');
    const terms = searchTerms(p.q);
    const ownerEmail = p.ownerEmail?.toLowerCase();
    const scored: { o: SfOpportunity; score: number }[] = [];
    for (const raw of this.opportunities.values()) {
      const rec = this.record(raw);
      if (!rec) continue;
      const o = rec.opportunity;
      if (p.openOnly && o.isClosed) continue;
      if (ownerEmail && o.ownerEmail !== ownerEmail) continue;
      const text = `${o.name} ${o.accountName ?? ''}`;
      let score = 0;
      let all = true;
      for (const term of terms) {
        const s = termScore(term, text);
        if (s === 0) {
          all = false;
          break;
        }
        score += s;
      }
      if (all) scored.push({ o, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score || (b.o.systemModstamp ?? '').localeCompare(a.o.systemModstamp ?? ''),
    );
    return scored.slice(0, p.limit).map((s) => s.o);
  }

  async getOpportunity(id: string): Promise<SfOpportunityRecord | null> {
    await this.enter('getOpportunity');
    const raw = this.opportunities.get(id);
    return raw ? this.record(raw) : null;
  }

  async getAccount(id: string): Promise<SfAccount | null> {
    await this.enter('getAccount');
    const raw = this.accounts.get(id);
    return raw ? mapAccount(raw) : null;
  }

  async *listChangedOpportunities(since: Date | null): AsyncIterable<SfOpportunityRecord[]> {
    await this.enter('listChangedOpportunities');
    const sinceIso = since?.toISOString() ?? null;
    const changed = [...this.opportunities.values()]
      .map((raw) => ({ raw, at: timestamp(raw.SystemModstamp) ?? '' }))
      .filter(({ at }) => sinceIso === null || at > sinceIso)
      .sort((a, b) => a.at.localeCompare(b.at) || String(a.raw.Id).localeCompare(String(b.raw.Id)));
    for (let i = 0; i < changed.length; i += PAGE_SIZE) {
      const page = changed
        .slice(i, i + PAGE_SIZE)
        .map(({ raw }) => this.record(raw))
        .filter((r): r is SfOpportunityRecord => r !== null);
      yield page;
    }
  }

  async listDeletedOpportunityIds(start: Date, end: Date): Promise<string[]> {
    await this.enter('listDeletedOpportunityIds');
    return this.deleted
      .filter((d) => {
        const at = Date.parse(d.deletedDate);
        return at >= start.getTime() && at <= end.getTime();
      })
      .map((d) => d.id);
  }

  async getProductSpecs(opportunityId: string): Promise<SfProductSpec[]> {
    await this.enter('getProductSpecs');
    return this.specs
      .map((raw) => mapProductSpec(raw))
      .filter((s): s is SfProductSpec => s !== null && s.opportunityId === opportunityId);
  }

  // ── Test helpers: simulate changes made in Salesforce ─────────────────────────────────────────

  /** Add or replace an opportunity (as SF would after an edit; bump SystemModstamp yourself). */
  put(raw: Raw): void {
    this.opportunities.set(String(raw.Id), stripAttributes(raw));
  }

  /** Remove an opportunity as if deleted in SF at `at`. */
  remove(id: string, at: Date): void {
    this.opportunities = new Map([...this.opportunities].filter(([key]) => key !== id));
    this.deleted.push({ id, deletedDate: at.toISOString() });
  }

  /** The raw record (for tests that edit and re-`put` it). */
  raw(id: string): Raw | undefined {
    const raw = this.opportunities.get(id);
    return raw ? structuredClone(raw) : undefined;
  }

  get size(): number {
    return this.opportunities.size;
  }
}
