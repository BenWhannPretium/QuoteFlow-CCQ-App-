import { describe, expect, it } from 'vitest';

import { erfLinkage, normaliseErf, ownerMatch } from './salesforce';

describe('ERF linkage', () => {
  it('normalises the formats SF holds ("used inconsistently")', () => {
    expect(normaliseErf('ERF-2026-00042')).toBe('202600042');
    expect(normaliseErf('erf#12345')).toBe('12345');
    expect(normaliseErf('ERF 12345')).toBe('12345');
    expect(normaliseErf('  ')).toBeNull();
    expect(normaliseErf(null)).toBeNull();
  });

  it('classifies each quote', () => {
    expect(erfLinkage(null, null)).toBe('both_missing');
    expect(erfLinkage('ERF 12345', null)).toBe('sf_only');
    expect(erfLinkage(null, '12345')).toBe('ccq_only');
    expect(erfLinkage('erf#12345', '12345')).toBe('match');
    expect(erfLinkage('ERF 12345', '12346')).toBe('mismatch');
  });
});

describe('ownerMatch (mine=true)', () => {
  it('matches on email, UPN and the UPN alias, lower-cased', () => {
    expect(ownerMatch({ email: 'Ben.Whann@Example.com', upn: 'ben.whann@example.com' })).toEqual({
      emails: ['ben.whann@example.com'],
      aliases: ['ben.whan'],
    });
    expect(ownerMatch({ email: null, upn: 'kam@dev.example.com' })).toEqual({
      emails: ['kam@dev.example.com'],
      aliases: ['kam'],
    });
  });
});
