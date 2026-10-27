import type { CreateFeedbackBody, FeedbackItem, UpdateFeedbackBody } from '@ccq/contracts';
import { uuidv7, type DbOrTx } from '@ccq/db';
import {
  findFeedback,
  findFeedbackScreenshot,
  findUserById,
  insertFeedback,
  listFeedback,
  updateFeedback,
  type FeedbackListRow,
} from '@ccq/db/repos';
import {
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  feedbackIssueMarkdown,
  feedbackIssueTitle,
  type Actor,
} from '@ccq/domain';

import { ServiceProblem } from './problem';
import { recordAudit, type AuditMeta } from '../plugins/audit';

export type FeedbackWithTx = <T>(fn: (tx: DbOrTx) => Promise<T>) => Promise<T>;

/** Magic bytes, so a renamed file can't pose as an image. */
function sniffImage(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function toItem(r: FeedbackListRow): FeedbackItem {
  const base = {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    reporterId: r.reporterId,
    reporterName: r.reporterName,
    reporterRoles: r.reporterRoles,
    type: r.type as FeedbackItem['type'],
    severity: r.severity,
    description: r.description,
    route: r.route,
    quoteNumber: r.quoteNumber,
    appVersion: r.appVersion,
    userAgent: r.userAgent,
    viewport: r.viewport,
    hasScreenshot: r.hasScreenshot,
    status: r.status as FeedbackItem['status'],
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    githubIssueUrl: r.githubIssueUrl,
    triageNote: r.triageNote,
  };
  return {
    ...base,
    issueTitle: feedbackIssueTitle(base),
    issueMarkdown: feedbackIssueMarkdown(base),
  };
}

/**
 * B-23 in-app feedback. Anyone signed in reports (feedback.submit); Admin triages (feedback.triage).
 * Every report and every triage change writes an audit row.
 */
export class FeedbackService {
  constructor(private readonly opts: { now?: () => Date } = {}) {}

  private now() {
    return (this.opts.now ?? (() => new Date()))();
  }

  async create(
    withTx: FeedbackWithTx,
    actor: Actor,
    body: CreateFeedbackBody,
    meta: AuditMeta,
  ): Promise<{ id: string }> {
    let screenshot: Buffer | null = null;
    if (body.screenshot) {
      screenshot = Buffer.from(body.screenshot.dataBase64, 'base64');
      if (screenshot.length > FEEDBACK_SCREENSHOT_MAX_BYTES) {
        throw new ServiceProblem(413, 'screenshot_too_large', 'The screenshot is over 2 MB.');
      }
      if (sniffImage(screenshot) !== body.screenshot.contentType) {
        throw new ServiceProblem(
          415,
          'screenshot_not_image',
          'The screenshot is not a PNG, JPEG or WebP image.',
        );
      }
    }
    const id = uuidv7();
    const at = this.now();
    await withTx(async (tx) => {
      await insertFeedback(tx, {
        id,
        createdAt: at,
        updatedAt: at,
        createdBy: actor.userId,
        reporterId: actor.userId,
        reporterRoles: actor.roles.join(', '),
        type: body.type,
        severity: body.severity,
        description: body.description,
        route: body.route,
        quoteNumber: body.quoteNumber ?? null,
        appVersion: body.appVersion ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        viewport: body.viewport ?? null,
        screenshot,
        screenshotType: screenshot ? body.screenshot!.contentType : null,
      });
      await recordAudit(tx, actor, meta, {
        at,
        action: 'create',
        entity: 'feedback',
        entityId: id,
        after: {
          type: body.type,
          severity: body.severity,
          route: body.route,
          quoteNumber: body.quoteNumber ?? null,
          screenshot: screenshot !== null,
        },
      });
    });
    return { id };
  }

  async list(withTx: FeedbackWithTx, status?: string): Promise<FeedbackItem[]> {
    const rows = await withTx((tx) => listFeedback(tx, { status }));
    return rows.map(toItem);
  }

  async screenshot(withTx: FeedbackWithTx, id: string) {
    const shot = await withTx((tx) => findFeedbackScreenshot(tx, id));
    if (!shot) throw new ServiceProblem(404, 'not_found', 'No screenshot for this report.');
    return shot;
  }

  async update(
    withTx: FeedbackWithTx,
    actor: Actor,
    id: string,
    body: UpdateFeedbackBody,
    meta: AuditMeta,
  ): Promise<FeedbackItem> {
    const at = this.now();
    return withTx(async (tx) => {
      const before = await findFeedback(tx, id);
      if (!before) throw new ServiceProblem(404, 'not_found', 'Feedback not found');
      if (body.ownerId && !(await findUserById(tx, body.ownerId))) {
        throw new ServiceProblem(422, 'unknown_owner', 'The owner is not a QuoteFlow user.');
      }
      const changes = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined),
      ) as Parameters<typeof updateFeedback>[2];
      await updateFeedback(tx, id, { ...changes, updatedAt: at });
      await recordAudit(tx, actor, meta, {
        at,
        action: 'update',
        entity: 'feedback',
        entityId: id,
        before: Object.fromEntries(
          Object.keys(changes).map((k) => [k, before[k as keyof typeof before]]),
        ),
        after: changes,
      });
      return toItem((await findFeedback(tx, id))!);
    });
  }
}
