import { describe, expect, it } from 'vitest';

import { definitionSentences } from './InfoTip';

describe('definitionSentences', () => {
  it('splits a definition into its sentences', () => {
    expect(
      definitionSentences(
        'The share of decided proposals that were won. Win rate = awarded ÷ (awarded + lost). Only decided quotes count.',
      ),
    ).toEqual([
      'The share of decided proposals that were won.',
      'Win rate = awarded ÷ (awarded + lost).',
      'Only decided quotes count.',
    ]);
  });

  it('does not split inside brackets or after an abbreviation', () => {
    expect(
      definitionSentences('Median days to decide (a Hold does not count. Really), e.g. this one.'),
    ).toEqual(['Median days to decide (a Hold does not count. Really), e.g. this one.']);
  });
});
