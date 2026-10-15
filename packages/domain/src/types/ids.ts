declare const brand: unique symbol;

/** Nominal typing for plain strings so a QuoteId can't be passed where a UserId is expected. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type QuoteId = Brand<string, 'QuoteId'>;
export type UserId = Brand<string, 'UserId'>;
export type QuoteNumber = Brand<string, 'QuoteNumber'>;

export const asQuoteId = (value: string): QuoteId => value as QuoteId;
export const asUserId = (value: string): UserId => value as UserId;
