import { withRequestContext, withSystemContext, type Database, type Tx } from '@ccq/db';
import {
  getQuoteById,
  getQuoteSummaryByNumber,
  getSetting,
  getUserScope,
  listUserRoles,
  listValueList,
  type NotificationRow,
} from '@ccq/db/repos';
import { asUserId, type Actor } from '@ccq/domain';

import type { EmailDigestItem, EmailModel, EmailQuote } from '../emails';
import type { GateService } from './gateService';
import { summaryDto, type QuoteReadService } from './quotes';
import { defaultScopeFrom } from '../auth/directory';

/** The G1 gate and its "To qualify" queue (`/approvals?gate=G1`). */
const DIGEST_GATE_KEY = 'G1';
/** The digest lists this many quotes, then "…and N more". */
export const DIGEST_MAX_ITEMS = 25;

export interface EmailContentDeps {
  database: Database;
  quotes: QuoteReadService;
  gates: GateService;
  /** `APP_BASE_URL`: deep links start here. */
  appBaseUrl: string;
  now: () => Date;
}

/** Notification types whose deep link opens the Engineering tab of the quote. */
const ENGINEERING_TYPES = new Set(['quote.ready_for_eng_review', 'quote.assigned']);

const stringsOnly = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((value ?? {}) as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );

/**
 * Turns an email row into what a template needs. Quote facts (account, product, tier) are read **as the
 * recipient** (their roles, their data scope, RLS on), so an email can never say more than the recipient
 * may see in the app; a quote they cannot read yields the quote number and a link only. Nothing here
 * reads a pricing, margin or capital field: the types do not carry one.
 */
export class EmailContentBuilder {
  private readonly base: string;

  constructor(private readonly deps: EmailContentDeps) {
    this.base = deps.appBaseUrl.replace(/\/+$/, '');
  }

  private url(path: string) {
    return `${this.base}${path}`;
  }

  private quoteUrl(type: string, quoteNumber: string): string {
    const n = encodeURIComponent(quoteNumber);
    if (type === 'quote.ready_for_final_review') return this.url(`/quotes/${n}/review`);
    return ENGINEERING_TYPES.has(type)
      ? this.url(`/quotes/${n}?tab=engineering`)
      : this.url(`/quotes/${n}`);
  }

  private actorFor(userId: string): Promise<Actor> {
    return withSystemContext(this.deps.database, async (tx) => ({
      userId: asUserId(userId),
      roles: await listUserRoles(tx, userId),
      scope:
        (await getUserScope(tx, userId)) ??
        defaultScopeFrom(await getSetting(tx, 'default_scope_type')),
    }));
  }

  private async labels(tx: Tx) {
    const [families, resins] = await Promise.all([
      listValueList(tx, 'product_family', { activeOnly: false }),
      listValueList(tx, 'resin', { activeOnly: false }),
    ]);
    const byCode = (rows: { code: string; label: string }[]) =>
      new Map(rows.map((r) => [r.code, r.label]));
    const family = byCode(families);
    const resin = byCode(resins);
    return (productFamily: string | null, resinCode: string | null): string | null => {
      const parts = [
        productFamily ? (family.get(productFamily) ?? productFamily) : null,
        resinCode ? (resin.get(resinCode) ?? resinCode) : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' · ') : null;
    };
  }

  /** The email for `row`, or null when there is nothing to say (an empty digest). */
  async build(row: NotificationRow): Promise<EmailModel | null> {
    const actor = await this.actorFor(row.userId);
    const preferencesUrl = this.url('/me/preferences');
    if (row.type === 'quote.to_qualify') {
      const digest = await this.digest(actor);
      return digest ? { type: row.type, quote: null, payload: {}, digest, preferencesUrl } : null;
    }
    return {
      type: row.type,
      quote: row.quoteId ? await this.quote(actor, row.type, row.quoteId) : null,
      payload: stringsOnly(row.payload),
      preferencesUrl,
    };
  }

  private async quote(actor: Actor, type: string, quoteId: string): Promise<EmailQuote | null> {
    // The number alone is not sensitive: read it without the recipient's scope, so an out-of-scope
    // recipient still gets "CCQ-… needs you" and a link (the app then enforces access).
    const number = await withSystemContext(
      this.deps.database,
      async (tx) => (await getQuoteById(tx, quoteId))?.quoteNumber,
    );
    if (!number) return null;
    const facts = await withRequestContext(this.deps.database, actor, async (tx) => {
      const found = await getQuoteSummaryByNumber(tx, number);
      if (!found) return null;
      const ctx = await this.deps.quotes.context(tx, actor, this.deps.now());
      const dto = summaryDto(found, ctx);
      const product = (await this.labels(tx))(dto.productFamily, dto.resin);
      return {
        account: dto.customerName ?? dto.opportunityName,
        product,
        tier: dto.priority.visible && dto.priority.tierLabel ? dto.priority.tierLabel : null,
      };
    });
    return {
      number,
      account: facts?.account ?? null,
      product: facts?.product ?? null,
      tier: facts?.tier ?? null,
      url: this.quoteUrl(type, number),
    };
  }

  /** Every quote waiting at G1 that the recipient may see, highest priority first. */
  private async digest(actor: Actor) {
    const withTx = <T>(fn: (tx: Tx) => Promise<T>) =>
      withRequestContext(this.deps.database, actor, fn);
    const queue = await this.deps.gates.queue(withTx, actor, DIGEST_GATE_KEY);
    if (!queue.gate.enabled || queue.items.length === 0) return null;
    const label = await withTx((tx) => this.labels(tx));
    const items: EmailDigestItem[] = queue.items.slice(0, DIGEST_MAX_ITEMS).map((q) => ({
      number: q.quoteNumber,
      account: q.customerName ?? q.opportunityName,
      product: label(q.productFamily, q.resin),
      tier: q.priority.visible && q.priority.tierLabel ? q.priority.tierLabel : null,
      url: this.url(`/quotes/${encodeURIComponent(q.quoteNumber)}`),
    }));
    return {
      items,
      more: Math.max(0, queue.items.length - items.length),
      url: this.url(`/approvals?gate=${DIGEST_GATE_KEY}`),
    };
  }
}
