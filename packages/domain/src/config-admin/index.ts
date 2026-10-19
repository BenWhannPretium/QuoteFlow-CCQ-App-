/**
 * Admin configuration console (B-19, CR-51): validators and pure helpers behind
 * `/api/v1/admin/config/*`. "Configure what is pending": every open business value is data, edited
 * here with a change reason, versioned and audited.
 */
export * from './diff';
export * from './scoring-preview';
export * from './settings';
