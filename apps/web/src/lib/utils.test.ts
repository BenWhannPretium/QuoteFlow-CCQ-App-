import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting tailwind classes', () => {
    const hidden = false;
    expect(cn('p-2', 'p-4', hidden && 'hidden')).toBe('p-4');
  });
});
