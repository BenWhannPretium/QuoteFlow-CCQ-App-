import type { MetricInfo } from '@ccq/contracts';
import { InfoIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * The info tooltip every metric carries: its definition and its time window. A popover rather than a
 * hover tooltip, so it opens on touch and from the keyboard and can be read at leisure.
 */
/**
 * Sentences of a definition, split outside brackets (so "(a Hold does not count). Next" splits once and
 * "e.g. this" does not). Exported for the test.
 */
export function definitionSentences(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (
      ch === '.' &&
      depth === 0 &&
      text[i + 1] === ' ' &&
      /[A-Z“"$]/.test(text[i + 2] ?? '')
    ) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 2;
    }
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Bailey (2026-11-12): a definition reads at a glance. One sentence says what the number is; anything
 * after it (how it is calculated, what counts) is a short list, not a paragraph.
 */
function Definition({ text }: { text: string }) {
  const [lead, ...facts] = definitionSentences(text);
  return (
    <>
      <p>{lead}</p>
      {facts.length > 0 && (
        <ul className="text-muted-foreground list-disc space-y-1 pl-4">
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function InfoTip({ label, info }: { label: string; info: MetricInfo }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}: definition and time window`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-11 shrink-0 sm:size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
        >
          <InfoIcon className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="grid gap-3 text-sm" data-testid="info-popover">
        <div className="grid gap-1">
          <p className="text-emphasis text-xs font-semibold tracking-wider uppercase">Definition</p>
          <Definition text={info.definition} />
        </div>
        <div className="grid gap-1">
          <p className="text-emphasis text-xs font-semibold tracking-wider uppercase">
            Time window
          </p>
          <p>{info.window}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
