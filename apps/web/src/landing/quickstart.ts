/** B-23: the quick-start section for a role in /help/quickstart.html (docs/uat/quickstart). */
const ANCHORS: Record<string, string> = {
  KAM: 'kam',
  SalesLeader: 'sales-leader',
  EngLead: 'eng-lead',
  Engineer: 'engineer',
  Pricing: 'pricing',
  PricingLead: 'pricing',
  Approver: 'approver',
  Leadership: 'leadership',
  Admin: 'admin',
};

export const quickstartAnchor = (role: string): string => ANCHORS[role] ?? 'kam';

export const quickstartHref = (role: string | undefined) =>
  `/help/quickstart.html${role ? `#${quickstartAnchor(role)}` : ''}`;

/**
 * Split docs/uat/quickstart/print.html (the source) into the help page and its stylesheet. The API's
 * CSP is `style-src 'self'`, so the inline <style> moves to quickstart.css. quickstart.test.ts checks
 * public/help is in step; `UPDATE_QUICKSTART=1 pnpm --filter @ccq/web test` rewrites it.
 */
export function splitQuickstart(source: string): { html: string; css: string } {
  if (/<script/i.test(source) || / style="/.test(source)) {
    throw new Error('print.html must have no scripts or style attributes (CSP)');
  }
  const css = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => (m[1] ?? '').trim())
    .join('\n\n');
  const html = source
    .replace(/\s*<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace('</head>', '  <link rel="stylesheet" href="./quickstart.css" />\n</head>');
  return { html, css: `${css}\n` };
}
