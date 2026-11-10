# Session 2: Engineering Lead and Engineer

Read `00-common.md` first. Scope name for the report and branch: `engineering`.

**Scripts:** `docs/uat/scripts/engineering.md` (all parts, including Part E for FB-06, Part F for the plants
and Part G for FB-08, FB-09 and FB-12). **Quick-starts:** `eng-lead.md`, `engineer.md`.
**Personas:** `eng-lead`, `engineer`, `engineer-owner`. Use `kam`, `sales-leader` and `pricing-lead` to feed
and move quotes.

## Features to cover

**Queue and assignment**
- The engineering queue (order by priority, filters), the lead's assign and reassign dialog with
  **"Suggested: <name>"** from the routing rules (ISBM, RHB and injection to one engineer; EBM and IBM to the
  other; resin as the fallback while the process is not chosen). The suggestion never assigns anyone, and a
  name that matches no user suggests nobody. An engineer cannot assign.
- `engineer-owner` sees only assigned quotes; `engineer` all. Check lists, direct links and the API.

**Engineering Review**
- Fields and limits: process type, machine type (the 14 codes from Jim's list), plant (22 locations), cavitation (whole number 1 to 99), cycle time, tooling notes, technical concept notes, Supply Chain notes. Retired plants and machine types: an old quote still shows them as "(no longer offered)" and a new write is refused.
- The **budgetary capital estimate** field: its label and help text, the limits, who sees it (every role that can read the quote).
- Two-step process (FB-06): the checkbox reveals preform plant, blow plant, preform number (40) and the freight note (300); unticking clears them; Pricing sees them.
- Pack-out (FB-06): units per bag, tray, case and pallet are whole numbers from 1; blank is allowed; Pricing sees them.
- **Equipment BOM upload (FB-06):** the EngLead or assigned engineer uploads; a new upload becomes version 2 and earlier ones stay listed and downloadable; removing a wrong upload within 24 hours makes the previous version current; it locks after G2; Pricing and Final Review see file, version, uploader and date; the two old free-text boxes are read-only "Legacy notes". **G2 "Advance – capital required" is refused without a BOM on file**, and accepted with one.
- The "From the intake" block: resin and "Other" detail, market and sub-market, neck, PCR, color, additives, variants.
- FB-08: **funding and MOQ are Engineering's** on the quote (the assigned engineer and the lead can edit; nobody else can).

**Capacity evidence**
- Rows: site (plant list), line or asset, assumed effectiveness (required on a new row, never defaulted), cycle time, utilization before (entered), allocated volume, run days, analysis date, analyst. **Utilization after is calculated** and cannot be typed; there is no buffer field. CSV export. Capacity sign-off (approved, or blocked with a note) by the capacity owner; G2 Advance needs it approved.

**Lead review and G2**
- The engineer **submits to the lead**; the lead is told; the lead decides G2 or sends it back with a note; the engineer's part is locked while submitted and reopens on a send-back; the lead can act at any time. A G2 decision by an engineer (not the lead) is refused.
- Every G2 outcome: Advance, Proceed with risk, Advance – capital required, Hold (with a review date and owner), Return to KAM (reason and note), and anything else the seeded gate offers. Check the next owner, the notification, the lock and the audit entry for each.

## Cross-role checks you own

- The KAM's intake data reaches Engineering intact (including Other details and sub-market).
- After G2 advance the pricing lead is told; after Return, the KAM is told with the reason.
- Pricing can read everything Engineering entered (BOM, two-step, pack-out, capital estimate) on the Quoting tab; no role is hidden from a figure it can enter (CLAUDE.md rule 2).
