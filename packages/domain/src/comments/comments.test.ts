import { describe, expect, it } from 'vitest';

import { parseMarkdownLite, plainTextOf, resolveMentions, sanitizeCommentBody } from './index';

const ana = { userId: 'u-ana', name: 'Ana Ruiz' };
const an = { userId: 'u-an', name: 'Ana' };

describe('sanitizeCommentBody', () => {
  it('strips tags and control characters, normalises newlines and blank lines', () => {
    expect(
      sanitizeCommentBody(
        '  <script>alert(1)</script>Hello\u0007 <b>there</b>\r\n\r\n\r\n\r\nNext   \n<!-- x -->line  ',
      ),
    ).toBe('alert(1)Hello there\n\nNext\nline');
  });

  it('keeps comparison operators that are not tags', () => {
    expect(sanitizeCommentBody('cycle < 12 s and > 9 s')).toBe('cycle < 12 s and > 9 s');
  });
});

describe('resolveMentions', () => {
  it('keeps only picked users whose @Name is still in the text, once each', () => {
    expect(
      resolveMentions('Thanks @Ana Ruiz and again @Ana Ruiz', [
        ana,
        ana,
        { userId: 'u-bo', name: 'Bo' },
        { userId: 'u-x', name: ' ' },
      ]),
    ).toEqual([ana]);
  });
});

describe('parseMarkdownLite', () => {
  it('renders inline marks, links and mentions as tokens', () => {
    expect(
      parseMarkdownLite(
        '**Bold** _it_ *em* `code` see https://example.com/a?b=1. @Ana Ruiz and @Ana',
        [an, ana],
      ),
    ).toEqual([
      {
        t: 'p',
        lines: [
          [
            { t: 'strong', v: 'Bold' },
            { t: 'text', v: ' ' },
            { t: 'em', v: 'it' },
            { t: 'text', v: ' ' },
            { t: 'em', v: 'em' },
            { t: 'text', v: ' ' },
            { t: 'code', v: 'code' },
            { t: 'text', v: ' see ' },
            { t: 'link', v: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
            { t: 'text', v: '. ' },
            { t: 'mention', v: '@Ana Ruiz', userId: 'u-ana' },
            { t: 'text', v: ' and ' },
            { t: 'mention', v: '@Ana', userId: 'u-an' },
          ],
        ],
      },
    ]);
  });

  it('splits paragraphs, keeps line breaks and builds bullet lists', () => {
    expect(parseMarkdownLite('One\ntwo\n\n- a\n* b\nafter\n\n\n')).toEqual([
      { t: 'p', lines: [[{ t: 'text', v: 'One' }], [{ t: 'text', v: 'two' }]] },
      { t: 'ul', items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] },
      { t: 'p', lines: [[{ t: 'text', v: 'after' }]] },
    ]);
  });

  it('does not treat snake_case or a stray asterisk as emphasis, nor link javascript:', () => {
    expect(parseMarkdownLite('ship_to_original 2 * 3 javascript:alert(1)')).toEqual([
      { t: 'p', lines: [[{ t: 'text', v: 'ship_to_original 2 * 3 javascript:alert(1)' }]] },
    ]);
  });

  it('plain text drops the markers', () => {
    expect(plainTextOf('**Hi** @Ana\n\n- one', [an])).toBe('Hi @Ana\n\n• one');
  });
});
