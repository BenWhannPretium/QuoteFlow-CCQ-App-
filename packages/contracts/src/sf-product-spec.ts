import { z } from 'zod';

// Kept apart from salesforce.ts so intake.ts can use it without an import cycle (FB-15).

/** One row of the custom "Opportunity Product Specification" object (API name confirmed at M3). */
export const SfProductSpec = z.object({
  id: z.string(),
  opportunityId: z.string(),
  name: z.string().nullable(),
  productType: z.string().nullable(),
  resin: z.string().nullable(),
  capacity: z.string().nullable(),
  neckFinish: z.string().nullable(),
  color: z.string().nullable(),
  annualVolume: z.number().nullable(),
});
export type SfProductSpec = z.infer<typeof SfProductSpec>;

/**
 * FB-15 (W13-04): whether the opportunity's product specifications were read. `none`: Salesforce has no
 * specification row for it; `unavailable`: the live read failed (the snapshot keeps no specifications).
 */
export const SF_PRODUCT_SPECS_STATUSES = ['found', 'none', 'unavailable'] as const;
export type SfProductSpecsStatus = (typeof SF_PRODUCT_SPECS_STATUSES)[number];
