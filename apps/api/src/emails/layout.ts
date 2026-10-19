import { markup, type Safe } from './html';

// Brand colours from apps/web/src/styles/tokens.css (--pf-*), inlined: mail clients ignore stylesheets.
const GREEN = '#225651';
const INK = '#14211f';
const MUTED = '#416f6b';
const LINE = '#dfe6e5';
const SURFACE = '#f5f7f6';
const FONT = "Helvetica, Arial, 'Segoe UI', sans-serif";

export interface Fact {
  label: string;
  value: string;
}

export interface LayoutInput {
  /** The inbox preview line. */
  preheader: string;
  heading: string;
  /** The action needed, one or two sentences. */
  intro: string;
  facts: Fact[];
  /** A list under the facts (the digest). */
  rows?: { title: string; detail: string; url: string }[];
  rowsNote?: string;
  cta: { label: string; url: string };
  preferencesUrl: string;
}

/** Branded, table-based HTML (renders in Outlook) and its plain-text twin. */
export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const facts = input.facts.map(
    (f) =>
      markup`<tr>
        <td
          style="padding:6px 16px 6px 0;color:${MUTED};font-size:13px;white-space:nowrap;vertical-align:top"
        >
          ${f.label}
        </td>
        <td style="padding:6px 0;color:${INK};font-size:14px">${f.value}</td>
      </tr>`,
  );
  const rows = (input.rows ?? []).map(
    (r) =>
      markup`<tr>
        <td style="padding:10px 0;border-top:1px solid ${LINE}">
          <a
            href="${r.url}"
            style="color:${GREEN};font-weight:bold;font-size:14px;text-decoration:none"
            >${r.title}</a
          >
          <div style="color:${MUTED};font-size:13px;padding-top:2px">${r.detail}</div>
        </td>
      </tr>`,
  );
  const body: Safe = markup`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${input.heading}</title>
      </head>
      <body style="margin:0;padding:0;background:${SURFACE};font-family:${FONT};color:${INK}">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0">${input.preheader}</div>
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          style="background:${SURFACE}"
        >
          <tr>
            <td align="center" style="padding:24px 12px">
              <table
                role="presentation"
                width="600"
                cellpadding="0"
                cellspacing="0"
                style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:8px"
              >
                <tr>
                  <td
                    style="background:${GREEN};color:#ffffff;padding:16px 24px;font-size:22px;border-radius:8px 8px 0 0"
                  >
                    QuoteFlow
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px">
                    <h1 style="margin:0 0 12px;font-size:18px;line-height:24px;color:${INK}">
                      ${input.heading}
                    </h1>
                    <p style="margin:0 0 16px;font-size:14px;line-height:21px;color:${INK}">
                      ${input.intro}
                    </p>
                    ${
                      facts.length > 0
                        ? markup`<table
                            role="presentation"
                            cellpadding="0"
                            cellspacing="0"
                            style="margin:0 0 20px"
                          >
                            ${facts}
                          </table>`
                        : ''
                    }
                    ${
                      rows.length > 0
                        ? markup`<table
                            role="presentation"
                            width="100%"
                            cellpadding="0"
                            cellspacing="0"
                            style="margin:0 0 12px"
                          >
                            ${rows}
                          </table>`
                        : ''
                    }
                    ${input.rowsNote ? markup`<p style="margin:0 0 20px;font-size:13px;color:${MUTED}">${input.rowsNote}</p>` : ''}
                    <a
                      href="${input.cta.url}"
                      style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:11px 20px;border-radius:6px"
                      >${input.cta.label}</a
                    >
                  </td>
                </tr>
                <tr>
                  <td
                    style="padding:16px 24px;border-top:1px solid ${LINE};font-size:12px;line-height:18px;color:${MUTED}"
                  >
                    This is an automated message from QuoteFlow (Commercial Capital Quoting).
                    Replies are not read. Pricing and capital figures are never sent by email; open
                    the quote to see what you are cleared to see.
                    <a href="${input.preferencesUrl}" style="color:${GREEN}"
                      >Choose which emails you get</a
                    >.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`;

  const lines: string[] = [input.heading, '', input.intro, ''];
  for (const f of input.facts) lines.push(`${f.label}: ${f.value}`);
  if (input.facts.length > 0) lines.push('');
  for (const r of input.rows ?? []) lines.push(`- ${r.title} — ${r.detail}`, `  ${r.url}`);
  if ((input.rows ?? []).length > 0) lines.push('');
  if (input.rowsNote) lines.push(input.rowsNote, '');
  lines.push(
    `${input.cta.label}: ${input.cta.url}`,
    '',
    '--',
    'This is an automated message from QuoteFlow (Commercial Capital Quoting). Replies are not read.',
    'Pricing and capital figures are never sent by email; open the quote to see what you are cleared to see.',
    `Choose which emails you get: ${input.preferencesUrl}`,
  );
  return { html: body.value, text: lines.join('\n') };
}
