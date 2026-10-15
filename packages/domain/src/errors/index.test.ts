import { describe, expect, it } from 'vitest';

import { DomainError, ForbiddenError } from '.';

describe('errors', () => {
  it('DomainError carries code, message and optional field', () => {
    const error = new DomainError('MISSING_FIELD', 'x is required', 'x');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'DomainError',
      code: 'MISSING_FIELD',
      message: 'x is required',
      field: 'x',
    });
    expect(new DomainError('WRONG_STAGE', 'no').field).toBeUndefined();
  });

  it('ForbiddenError is a typed NOT_PERMITTED', () => {
    const error = new ForbiddenError('gate.G4.decide');
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      name: 'ForbiddenError',
      code: 'NOT_PERMITTED',
      permission: 'gate.G4.decide',
    });
    expect(new ForbiddenError('x', 'custom').message).toBe('custom');
  });
});
