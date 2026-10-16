/**
 * Quote comments (F-08): "markdown-lite" with @mentions. Bodies are stored as sanitized plain text
 * and rendered from the token tree below, never as HTML, so there is nothing to inject.
 *
 * Supported: paragraphs and line breaks, `- ` bullet lists, **bold**, _italic_ / *italic*, `code`,
 * bare http(s) links and @mentions of the users picked in the composer.
 */
export const COMMENT_MAX_LENGTH = 4000;
export const COMMENT_MAX_MENTIONS = 20;

/** Strip HTML tags and control characters, normalise newlines and blank lines. */
export function sanitizeCommentBody(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/<\/?[A-Za-z!][^>]*>/g, '')
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export interface MentionCandidate {
  userId: string;
  name: string;
}

/** The candidates whose `@Name` appears in the body (a picked user deleted from the text is not notified). */
export function resolveMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): MentionCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.userId) || !c.name.trim()) return false;
    const found = body.includes(`@${c.name}`);
    if (found) seen.add(c.userId);
    return found;
  });
}

export type InlineToken =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'mention'; v: string; userId: string };

export type BlockToken = { t: 'p'; lines: InlineToken[][] } | { t: 'ul'; items: InlineToken[][] };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function inlineTokens(line: string, mentions: readonly MentionCandidate[]): InlineToken[] {
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const mentionAlt = names.length ? `|@(${names.map((m) => escapeRegExp(m.name)).join('|')})` : '';
  const re = new RegExp(
    '`([^`]+)`|\\*\\*([^*]+)\\*\\*|\\*([^*\\s][^*]*)\\*|(?<![\\w])_([^_]+)_(?![\\w])|(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?\'"])' +
      mentionAlt,
    'g',
  );
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of line.matchAll(re)) {
    const at = m.index;
    if (at > last) out.push({ t: 'text', v: line.slice(last, at) });
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'strong', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'em', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'em', v: m[4] });
    else if (m[5] !== undefined) out.push({ t: 'link', v: m[5], href: m[5] });
    else if (m[6] !== undefined) {
      const who = names.find((n) => n.name === m[6])!;
      out.push({ t: 'mention', v: `@${who.name}`, userId: who.userId });
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ t: 'text', v: line.slice(last) });
  return out;
}

/** Parse a sanitized body into blocks of inline tokens. */
export function parseMarkdownLite(
  body: string,
  mentions: readonly MentionCandidate[] = [],
): BlockToken[] {
  const blocks: BlockToken[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    let para: InlineToken[][] = [];
    let list: InlineToken[][] = [];
    const flushPara = () => {
      if (para.length) blocks.push({ t: 'p', lines: para });
      para = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ t: 'ul', items: list });
      list = [];
    };
    for (const line of lines) {
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) {
        flushPara();
        list.push(inlineTokens(bullet[1]!, mentions));
      } else {
        flushList();
        para.push(inlineTokens(line, mentions));
      }
    }
    flushPara();
    flushList();
  }
  return blocks;
}

/** Plain-text rendering (notifications, CSV): markers removed, mentions kept as @Name. */
export function plainTextOf(body: string, mentions: readonly MentionCandidate[] = []): string {
  return parseMarkdownLite(body, mentions)
    .map((b) =>
      (b.t === 'p' ? b.lines : b.items.map((i) => [{ t: 'text', v: '• ' }, ...i]))
        .map((line) => line.map((tok) => tok.v).join(''))
        .join('\n'),
    )
    .join('\n\n');
}
