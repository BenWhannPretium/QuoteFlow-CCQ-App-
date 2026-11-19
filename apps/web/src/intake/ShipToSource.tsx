import type { ShipToSource } from '@ccq/contracts';

/**
 * FB-24 (N17-01): where the pre-filled ship-to came from, and the opportunity's free-text "Ship to
 * Locations" (Ship_to_Locations__c) shown read-only so the KAM can copy from it. The free text is never
 * parsed into the address. Screen words only; the source order is the `ship_to_sources` setting.
 */

const SOURCE_WORDS: Record<ShipToSource, string> = {
  product_spec: "From the opportunity's product",
  account: 'From the account',
};

/** "From the opportunity's product" / "From the account". Nothing for a typed ship-to. */
export function ShipToSourceLine({ source }: { source: ShipToSource | null | undefined }) {
  if (!source) return null;
  return (
    <span className="text-muted-foreground block w-full text-xs" data-testid="ship-to-source">
      {SOURCE_WORDS[source]} in Salesforce.
    </span>
  );
}

/** "Ship-to noted on the opportunity: …", read-only, line breaks kept. Nothing when blank. */
export function SfShipToLocations({ text }: { text: string | null | undefined }) {
  const value = text?.trim();
  if (!value) return null;
  return (
    <div
      className="bg-muted/50 text-foreground rounded-md border px-3 py-2 text-sm"
      data-testid="sf-ship-to-locations"
    >
      <p className="text-muted-foreground text-xs font-medium">Ship-to noted on the opportunity:</p>
      <p className="break-words whitespace-pre-line">{value}</p>
    </div>
  );
}

/** Both: the opportunity's note first (copy from it), then where the pre-filled address came from. */
export function ShipToSourceNote({
  source,
  sfShipToLocations,
}: {
  source: ShipToSource | null | undefined;
  sfShipToLocations: string | null | undefined;
}) {
  return (
    <>
      <SfShipToLocations text={sfShipToLocations} />
      <ShipToSourceLine source={source} />
    </>
  );
}
