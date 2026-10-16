import type { CommentMention } from '@ccq/contracts';
import { parseMarkdownLite, type InlineToken } from '@ccq/domain';
import { Fragment } from 'react';

function Inline({ tok }: { tok: InlineToken }) {
  switch (tok.t) {
    case 'strong':
      return <strong>{tok.v}</strong>;
    case 'em':
      return <em>{tok.v}</em>;
    case 'code':
      return <code className="bg-muted rounded px-1 py-0.5 text-[0.85em]">{tok.v}</code>;
    case 'link':
      return (
        <a
          href={tok.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-emphasis break-all underline underline-offset-2"
        >
          {tok.v}
        </a>
      );
    case 'mention':
      return (
        <span className="text-emphasis font-medium" data-mention={tok.userId}>
          {tok.v}
        </span>
      );
    default:
      return <>{tok.v}</>;
  }
}

/**
 * A comment's markdown-lite, rendered from the domain's token tree as React elements, never as HTML,
 * so nothing in a comment can inject markup or script.
 */
export function CommentBody({ body, mentions }: { body: string; mentions: CommentMention[] }) {
  const blocks = parseMarkdownLite(body, mentions);
  return (
    <div className="grid gap-2 text-sm break-words" data-testid="comment-body">
      {blocks.map((b, i) =>
        b.t === 'p' ? (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {line.map((tok, k) => (
                  <Inline key={k} tok={tok} />
                ))}
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={i} className="list-disc pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                {item.map((tok, k) => (
                  <Inline key={k} tok={tok} />
                ))}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
