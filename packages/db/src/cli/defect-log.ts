import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderDefectLog } from '@ccq/domain';

import { createDb } from '../client';
import { redactUrl, requireDatabaseUrl } from './env';
import { listFeedback } from '../repos/feedback';

/**
 * B-23 `pnpm uat:defects`: render docs/uat/defect-log.md from the feedback table (run daily during
 * UAT, after the 4 PM triage). Connect as the migration login (it reads every report). The file is
 * git-ignored: report text can name customers, so share it on SharePoint, never in the repo.
 */
const url = requireDatabaseUrl();
const target = fileURLToPath(new URL('../../../../docs/uat/defect-log.md', import.meta.url));
const client = createDb(url, { max: 1 });
try {
  const rows = await listFeedback(client.db, { limit: 5000 });
  const now = new Date();
  writeFileSync(
    target,
    renderDefectLog(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        type: r.type,
        severity: r.severity,
        status: r.status,
        route: r.route,
        quoteNumber: r.quoteNumber,
        reporterRoles: r.reporterRoles,
        ownerName: r.ownerName,
        githubIssueUrl: r.githubIssueUrl,
        summary: r.description,
      })),
      `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    ),
  );
  console.warn(`wrote ${rows.length} reports from ${redactUrl(url)} to docs/uat/defect-log.md`);
} finally {
  await client.close();
}
