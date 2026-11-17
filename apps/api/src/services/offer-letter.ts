import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  OFFER_LETTER_PROBLEM_CODES,
  type GenerateOfferLetterBody,
  type GenerateOfferLetterResponse,
  type OfferLetterResponse,
  type OfferLetterSummary,
} from '@ccq/contracts';
import type { Tx } from '@ccq/db';
import {
  getModelSummaryByAttachment,
  getQuoteSummaryByNumber,
  getSetting,
  insertActivityEvent,
  insertAttachment,
  insertOfferLetter,
  listAttachments,
  listGateDecisions,
  listOfferLetters,
  listQuoteItems,
  listUsersByIds,
  listValueList,
  loadQuoteState,
  lockQuoteByNumber,
  nextOfferLetterNo,
  openStages,
} from '@ccq/db/repos';
import {
  CUSTOMER_DECISION_STAGE_KEY,
  OFFER_LETTER_TEMPLATE_SEED,
  RELEASE_GATE_KEY,
  buildOfferLetterModel,
  can,
  evaluateOfferReadiness,
  formatUsd,
  modelSummaryReasonText,
  offerItemPrices,
  parseAttachmentSettings,
  parseOfferLetterBlockIfCostingChanged,
  parseOfferLetterTemplate,
  parseOfferLetterWordingApproved,
  proposalCalendarDate,
  renderFolderTemplate,
  sanitizeFileName,
  type Actor,
  type OfferCostingFacts,
  type OfferFacts,
  type OfferInputs,
  type OfferItemFacts,
  type OfferReadiness,
  type OfferSettings,
  type OfferSpecFact,
  type QuoteState,
} from '@ccq/domain';
import type { FileStore, StoredFile } from '@ccq/integrations';
import type { FastifyBaseLogger } from 'fastify';

import { fieldsOf, loadModelSummarySettings } from './model-summary';
import { ServiceProblem } from './problem';
import { quoteItemSummaries } from './quote-items-view';
import { renderOfferLetterDocx } from '../documents/offer-letter-docx';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type OfferLetterWithTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const P = OFFER_LETTER_PROBLEM_CODES;

export interface OfferLetterServiceOptions {
  store: FileStore;
  log?: FastifyBaseLogger;
  now?: () => Date;
}

type QuoteRow = NonNullable<Awaited<ReturnType<typeof getQuoteSummaryByNumber>>>;

interface OfferContext {
  row: QuoteRow;
  state: QuoteState;
  facts: OfferFacts;
  settings: OfferSettings;
  /** The template setting did not validate: nothing can be generated until an Admin fixes it. */
  configError: string | null;
}

const iso = (d: Date) => d.toISOString();

/**
 * FB-20 (F-070): the customer offer letter. `view` says whether a letter can be made and what it will
 * print; `generate` makes one: in one transaction that locks the quote row it re-checks readiness on
 * the server, snapshots the prices, renders the Word document, stores it as an `offer_letter`
 * attachment and records the letter, its audit row (no prices, no customer text) and a timeline event.
 * Downloads go through the attachment download route (authorized and audited there).
 */
export class OfferLetterService {
  private readonly now: () => Date;

  constructor(private readonly opts: OfferLetterServiceOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  /** The quote's facts, as the letter needs them. 404 when the caller may not read its letters. */
  private async context(
    tx: Tx,
    actor: Actor,
    quoteNumber: string,
    lock: boolean,
  ): Promise<OfferContext> {
    if (lock) await lockQuoteByNumber(tx, quoteNumber);
    const row = await getQuoteSummaryByNumber(tx, quoteNumber);
    const state = row ? await loadQuoteState(tx, row.quote.id) : undefined;
    if (!row || !state || !can(actor, 'offer.read', state)) {
      throw new ServiceProblem(404, 'not-found', `No quote ${quoteNumber}`);
    }
    const q = row.quote;
    const [
      itemSummaries,
      itemRows,
      lists,
      stages,
      decisions,
      attachments,
      summarySettings,
      rawTemplate,
      rawApproved,
      rawBlock,
    ] = await Promise.all([
      quoteItemSummaries(tx, actor, q),
      listQuoteItems(tx, q.id),
      Promise.all(
        (
          [
            'color_type',
            'neck_diameter',
            'neck_finish_type',
            'decoration_type',
            'packaging_type',
            'requested_payment_terms',
            'price_basis',
            'freight_type',
            'tooling_funding_model',
            'mold_ownership',
          ] as const
        ).map(async (k) => [k, await listValueList(tx, k, { activeOnly: false })] as const),
      ),
      openStages(tx),
      listGateDecisions(tx, q.id),
      listAttachments(tx, q.id),
      loadModelSummarySettings(tx),
      getSetting(tx, 'offer_letter_template'),
      getSetting(tx, 'offer_letter_wording_approved'),
      getSetting(tx, 'offer_letter_block_if_costing_changed'),
    ]);
    const valueLists = new Map<string, { code: string; label: string }[]>(lists);
    const labelOf = (list: string, code: string | null | undefined) =>
      code ? (valueLists.get(list)?.find((v) => v.code === code)?.label ?? code) : null;

    // Config: a value the console would refuse only comes from a hand edit. The letter is then
    // refused (config_invalid) rather than made from a guess.
    let configError: string | null = null;
    const safe = <T>(fn: () => T, fallback: T): T => {
      try {
        return fn();
      } catch (err) {
        configError = err instanceof Error ? err.message : String(err);
        return fallback;
      }
    };
    const settings: OfferSettings = {
      template: safe(() => parseOfferLetterTemplate(rawTemplate), OFFER_LETTER_TEMPLATE_SEED),
      wordingApproved: safe(() => parseOfferLetterWordingApproved(rawApproved), false),
      blockIfCostingChanged: safe(() => parseOfferLetterBlockIfCostingChanged(rawBlock), true),
    };

    // Items, with the facts the Specifications table shows (the item row; else the quote's mirror).
    const items: OfferItemFacts[] = itemSummaries.map((s) => {
      const r = s.id ? itemRows.find((x) => x.id === s.id) : undefined;
      const src = r ?? q;
      const neck = [
        src.neckDiameterCustom ?? labelOf('neck_diameter', src.neckDiameter),
        src.neckFinishTypeCustom ?? labelOf('neck_finish_type', src.neckFinishType),
      ]
        .filter(Boolean)
        .join(' ');
      const specs: Partial<Record<OfferSpecFact, string | null>> = {
        material: s.resinLabel,
        color: src.colorDescription ?? labelOf('color_type', src.colorType),
        cavities: s.cavitation === null || s.cavitation === undefined ? null : String(s.cavitation),
        gramWeight: src.gramWeightG ? `${src.gramWeightG} g` : null,
        neckFinish: neck || null,
        decoration: src.decorationTypeOther ?? labelOf('decoration_type', src.decorationType),
        packaging: labelOf('packaging_type', src.packagingType),
      };
      return {
        id: s.id,
        itemNo: s.itemNo,
        label: s.label,
        containerSize: s.containerSize,
        standardDescription: s.standardDescription,
        plantLabel: s.plantLabel,
        annualVolume: s.estAnnualVolume ?? null,
        specs,
      };
    });

    // The current costing workbook version and its summary.
    const current = attachments
      .filter(
        (a) =>
          a.kind === 'cost_model' && a.version !== null && a.supersededAt === null && !a.removedAt,
      )
      .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
    let costing: OfferCostingFacts | null = null;
    if (current) {
      const [summary, users] = await Promise.all([
        getModelSummaryByAttachment(tx, current.id),
        listUsersByIds(tx, [current.uploadedBy]),
      ]);
      const status = (summary?.status ?? 'none') as OfferCostingFacts['status'];
      costing = {
        attachmentId: current.id,
        version: current.version ?? 1,
        fileName: current.fileName,
        uploadedAt: current.createdAt,
        uploadedByName: users[0]?.displayName ?? null,
        status,
        reasonText:
          status === 'none'
            ? 'no summary was read for this version; upload it again'
            : summary
              ? modelSummaryReasonText(
                  summary.status as Parameters<typeof modelSummaryReasonText>[0],
                  summary.reason as Parameters<typeof modelSummaryReasonText>[1],
                )
              : null,
        fields: summary
          ? fieldsOf(summary.fields).map((f) => ({
              key: f.key,
              itemNo: f.itemNo,
              unit: f.unit,
              state: f.state,
              number: f.number,
            }))
          : [],
      };
    }

    const g4Approvals = decisions.filter(
      (d) => d.gateKey === RELEASE_GATE_KEY && d.outcomeKey === 'approve',
    );
    const approvedAt = g4Approvals.length
      ? g4Approvals[g4Approvals.length - 1]!.decidedAt
      : q.proposalIssuedAt;

    const facts: OfferFacts = {
      quoteNumber: q.quoteNumber,
      quoteVersion: q.version,
      stageKey: q.stageKey,
      stageName: stages.find((s) => s.key === q.stageKey)?.label ?? q.stageKey,
      onHold: q.status === 'on_hold',
      proposalIssuedAt: q.proposalIssuedAt,
      validityUntil: q.validityUntil,
      approvedAt,
      customerName: row.customerName,
      kamName: row.kamName,
      toolingFundingModel: q.toolingFundingModel,
      termLabels: {
        paymentTerms:
          q.termsPaymentTermsCode === 'OTHER' || q.requestedPaymentTerms === 'OTHER'
            ? (q.termsPaymentTerms ?? q.requestedPaymentTermsOther ?? null)
            : labelOf(
                'requested_payment_terms',
                q.termsPaymentTermsCode ?? q.requestedPaymentTerms,
              ),
        priceBasis: labelOf('price_basis', q.priceBasis),
        freight: labelOf('freight_type', q.freightType),
        toolingFunding:
          q.toolingFundingModel === 'NOT_DISCUSSED'
            ? null
            : labelOf('tooling_funding_model', q.toolingFundingModel),
        moldOwnership: labelOf('mold_ownership', q.termsMoldOwnership),
      },
      items,
      summaryVisible: summarySettings.visible,
      costing,
    };
    return { row, state, facts, settings, configError };
  }

  private static readiness(ctx: OfferContext, inputs: OfferInputs | null): OfferReadiness {
    const r = evaluateOfferReadiness(ctx.facts, ctx.settings, inputs);
    if (ctx.configError && ctx.facts.stageKey === CUSTOMER_DECISION_STAGE_KEY) {
      r.blockers.push({
        code: 'config_invalid',
        message: `The offer letter settings are not valid (${ctx.configError}). Ask an Admin to fix them.`,
        itemNo: null,
        fixAt: 'admin',
      });
      r.canGenerate = false;
    }
    return r;
  }

  private static async letters(tx: Tx, quoteId: string, quoteVersion: number) {
    const [rows, attachments] = await Promise.all([
      listOfferLetters(tx, quoteId),
      listAttachments(tx, quoteId),
    ]);
    const users = await listUsersByIds(tx, [...new Set(rows.map((r) => r.generatedBy))]);
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return rows.map((r): OfferLetterSummary => ({
      id: r.id,
      letterNo: r.letterNo,
      attachmentId: r.attachmentId,
      fileName: attachments.find((a) => a.id === r.attachmentId)?.fileName ?? 'Offer letter.docx',
      letterDate: r.letterDate,
      attention: r.attention,
      itemCount: r.itemCount,
      quoteVersion: r.quoteVersion,
      superseded: r.quoteVersion !== quoteVersion,
      wordingApproved: r.wordingApproved,
      templateVersion: r.templateVersion,
      costModelVersion: r.costModelVersion,
      generatedByName: names.get(r.generatedBy) ?? null,
      generatedAt: iso(r.generatedAt),
    }));
  }

  /** GET /quotes/:qn/offer-letter. */
  async view(
    withTx: OfferLetterWithTx,
    actor: Actor,
    quoteNumber: string,
  ): Promise<OfferLetterResponse> {
    return withTx(async (tx) => {
      const ctx = await this.context(tx, actor, quoteNumber, false);
      const { facts, settings, row, state } = ctx;
      const available = facts.stageKey === CUSTOMER_DECISION_STAGE_KEY;
      const readiness = OfferLetterService.readiness(ctx, null);
      const costing = facts.costing;
      let preview: OfferLetterResponse['preview'] = null;
      if (available) {
        const m = buildOfferLetterModel(facts, { attention: null, partNumbers: {} }, settings);
        const prices = offerItemPrices(facts);
        preview = {
          to: m.header.to,
          date: m.header.dateText,
          validUntil: m.header.validUntilText,
          labels: m.pricing.labels,
          assumptions: m.assumptions.items,
          items: facts.items.map((i, idx) => {
            const p = prices.find((x) => x.itemNo === i.itemNo)!;
            return {
              itemId: i.id,
              itemNo: i.itemNo,
              name: m.items[idx]!.name,
              partDescription: m.items[idx]!.partDescription,
              placeOfManufacture: i.plantLabel,
              annualVolume: i.annualVolume,
              // Figures leave the server only when the summary may be shown (FB-14 setting).
              piecePricePer1000:
                facts.summaryVisible && p.piecePricePer1000 ? formatUsd(p.piecePricePer1000) : null,
              moldCharge: facts.summaryVisible && p.moldCharge ? formatUsd(p.moldCharge) : null,
              changePartsCharge:
                facts.summaryVisible && p.changePartsCharge ? formatUsd(p.changePartsCharge) : null,
            };
          }),
        };
      }
      return {
        quoteNumber: facts.quoteNumber,
        available,
        canGenerate: available && readiness.canGenerate,
        mayGenerate: can(actor, 'offer.generate', state),
        blockers: readiness.blockers,
        warnings: readiness.warnings,
        wordingApproved: settings.wordingApproved,
        draftText: settings.wordingApproved ? null : 'DRAFT: wording not yet approved by Legal',
        source: costing
          ? {
              attachmentId: costing.attachmentId,
              fileName: costing.fileName,
              version: costing.version,
              uploadedByName: costing.uploadedByName,
              uploadedAt: iso(costing.uploadedAt),
              text: `Read from ${costing.fileName} v${costing.version}, uploaded by ${costing.uploadedByName ?? 'someone'} on ${proposalCalendarDate(costing.uploadedAt)}`,
            }
          : null,
        preview,
        letters: await OfferLetterService.letters(tx, row.quote.id, row.quote.version),
      };
    });
  }

  /** POST /quotes/:qn/offer-letter. */
  async generate(
    withTx: OfferLetterWithTx,
    actor: Actor,
    quoteNumber: string,
    body: GenerateOfferLetterBody,
    meta: AuditMeta,
  ): Promise<GenerateOfferLetterResponse> {
    let stored: StoredFile | null = null;
    let removedFolder = 'Removed';
    try {
      return await withTx(async (tx) => {
        const now = this.now();
        // The quote row is locked for the rest of the transaction: two requests run one after the
        // other, each on what the other committed (letters 1 and 2, never a stale check).
        const ctx = await this.context(tx, actor, quoteNumber, true);
        const { facts, settings, row, state } = ctx;
        const q = row.quote;
        if (!can(actor, 'offer.generate', state)) {
          throw new ServiceProblem(
            403,
            'forbidden',
            "Only the quote's KAM, a sales leader, Pricing or an Admin can generate the offer letter (offer.generate)",
          );
        }

        // What was typed, by item number. An unknown item id is refused.
        const partNumbers: Record<number, string | null> = {};
        for (const entry of body.items) {
          const item = facts.items.find((i) => i.id === entry.itemId);
          if (!item) {
            throw new ServiceProblem(
              422,
              'validation',
              'An item on the request is not on this quote',
              {
                errors: [{ path: '/items', message: 'Unknown item', code: 'INVALID_VALUE' }],
              },
            );
          }
          partNumbers[item.itemNo] = entry.partNumber?.trim() || null;
        }
        const inputs: OfferInputs = { attention: body.attention?.trim() || null, partNumbers };

        const readiness = OfferLetterService.readiness(ctx, inputs);
        if (!readiness.canGenerate) {
          throw new ServiceProblem(
            409,
            P.notReady,
            readiness.blockers[0]?.message ?? 'The offer letter cannot be generated yet',
            { blockers: readiness.blockers },
          );
        }
        const unacknowledged = readiness.warnings.filter(
          (w) => !body.acknowledgedWarnings.includes(w.code),
        );
        if (unacknowledged.length) {
          throw new ServiceProblem(
            409,
            P.unacknowledged,
            'Tick each warning to confirm you have read it, then generate the letter',
            { warnings: unacknowledged },
          );
        }

        // Snapshot, render and store.
        const model = buildOfferLetterModel(facts, inputs, settings);
        const bytes = await renderOfferLetterDocx(model);
        const letterNo = await nextOfferLetterNo(tx, q.id);
        const attachmentSettings = parseAttachmentSettings(
          await getSetting(tx, 'attachment_settings'),
        );
        removedFolder = attachmentSettings.removedFolder;
        const folder = renderFolderTemplate(attachmentSettings.quoteFolder, {
          quote_number: q.quoteNumber,
        });
        const fileName = `${q.quoteNumber} Offer Letter ${letterNo}.docx`;
        stored = await this.opts.store.upload(
          `${folder}/${sanitizeFileName(fileName)}`,
          Readable.from(bytes),
          bytes.length,
          DOCX_MIME,
        );
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const attachment = await insertAttachment(tx, {
          quoteId: q.id,
          draftId: null,
          quoteItemId: null,
          kind: 'offer_letter',
          fileName,
          storedName: stored.name,
          size: bytes.length,
          mime: DOCX_MIME,
          note: null,
          sha256,
          storage: this.opts.store.kind,
          storageItemId: stored.itemId,
          storagePath: stored.folder,
          spDriveId: null,
          spItemId: this.opts.store.kind === 'sharepoint' ? stored.itemId : null,
          spWebUrl: stored.webUrl,
          uploadedBy: actor.userId,
          createdAt: now,
          createdBy: actor.userId,
        });
        const costing = facts.costing!;
        const prices = offerItemPrices(facts);
        const letter = await insertOfferLetter(
          tx,
          {
            quoteId: q.id,
            quoteVersion: q.version,
            letterNo,
            attachmentId: attachment.id,
            templateVersion: settings.template.templateVersion,
            wordingApproved: settings.wordingApproved,
            letterDate: model.header.date,
            attention: model.header.attention,
            validUntil: facts.validityUntil!,
            costModelAttachmentId: costing.attachmentId,
            costModelVersion: costing.version,
            generatedBy: actor.userId,
            generatedAt: now,
            createdBy: actor.userId,
          },
          model.items.map((line) => {
            const item = facts.items.find((i) => i.itemNo === line.itemNo)!;
            const p = prices.find((x) => x.itemNo === line.itemNo)!;
            return {
              quoteItemId: item.id,
              itemNo: line.itemNo,
              partDescription: line.partDescription,
              partNumber: line.partNumber,
              placeOfManufacture: line.placeOfManufacture,
              annualVolume: line.annualVolume,
              piecePricePer1000: p.piecePricePer1000,
              moldCharge: p.moldCharge,
              changePartsCharge: p.changePartsCharge,
            };
          }),
        );

        // The audit row and the timeline: what was made, from which files. No price, no customer
        // text (the Attention line and Part #s stay in the letter rows).
        await recordAudit(tx, actor, meta, {
          at: now,
          action: 'create',
          entity: 'offer_letter',
          entityId: letter.id,
          quoteId: q.id,
          after: {
            event: 'offer_letter.generated',
            letterNo,
            quoteVersion: q.version,
            itemCount: model.items.length,
            templateVersion: settings.template.templateVersion,
            wordingApproved: settings.wordingApproved,
            attachmentId: attachment.id,
            costModelAttachmentId: costing.attachmentId,
            costModelVersion: costing.version,
            acknowledgedWarnings: readiness.warnings.map((w) => w.code),
          },
        });
        await insertActivityEvent(tx, {
          quoteId: q.id,
          type: 'offer_letter_generated',
          actorId: actor.userId,
          at: now,
          payload: {
            letterNo,
            itemCount: model.items.length,
            wordingApproved: settings.wordingApproved,
            attachmentId: attachment.id,
          },
          createdBy: actor.userId,
        });
        const [summary] = (await OfferLetterService.letters(tx, q.id, q.version)).filter(
          (l) => l.id === letter.id,
        );
        return {
          letter: summary!,
          downloadPath: `/api/v1/attachments/${attachment.id}/download`,
        };
      });
    } catch (err) {
      // Nothing unreferenced is left in the quote folder when the transaction did not commit.
      if (stored) {
        const file = stored as StoredFile;
        await this.opts.store.delete(file.itemId, removedFolder).catch((e: unknown) => {
          this.opts.log?.warn({ err: e }, 'offer letter: could not move an orphaned file');
        });
      }
      throw err;
    }
  }
}
