# B-15 · Pricing application read connector (F-11)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md` rules 2 and 5 and `01-architecture.md` §6 (pricing row). PRD F-11: "Read ERF/BPR records to show pricing context on the quote. [Confirm with Pricing]." Read-only. No editing of figures, no write-back, and no rebuild of the pricing engine.

## Facts (from the evidence base)
- **Legacy app:** an unsupported .NET app ("cannot be changed"). Only IT can export from it. Attachments are stored as binaries in the database; extraction has "no firm date" (Cory McGahan, 10/13).
- **Back-end export** (Cory, 2026-09-22):
  - ERF 8,536 rows × 99 columns
  - BPR 26,561 × 62 (back to FY2012)
  - SPR 12,190 × 91
- **ERF columns include:**
  - Priority, Product_Class, Channel, Plant, Machine
  - Est_Revenue, Est_Volume, Est_Net_Capital
  - Decision_Type, Decision_By, Decision_Date, Decision_Reason
  - accepted/rejected/abandoned flags, Attachment_Count
  - **Days_Submitted_To_Engineer_Assigned / _ECE_Approved / _Price_Confirmed**
- **Terminology:** the PRD says "ERS"; it's **ERF**. SPR is **historical only** (retired Nov 2025). A BPR "always follows an approved quote". ERF↔BPR↔SPR is **not strictly 1:1**: Cory is validating the cardinality.
- Revenue, volume and net-capital fields blank themselves from ~FY25/26 on (cause unknown). Treat blanks as unknown, not zero.

## Decision from M5 (Oct 21); implement whichever was chosen, behind one interface
- **Route A:** a read-only SQL login (`mssql` / tedious, encrypted connection) to views or a replica that Cory exposes.
- **Route B:** the D&A-landed copy in Fabric, via its SQL analytics endpoint (TDS) with Entra auth (managed identity).

If M5 hasn't concluded, implement `FakePricingReader` + Route A with config placeholders, and keep the B-11 manual references as the fallback.

## Build
1. **`packages/integrations/pricing/`:**
   - `PricingReader` interface:
     - `getErf(erfNumber)`
     - `findErfs({ customerName?, sfOpportunityId?, text?, limit })`
     - `getBpr(bprNumber)`
     - `findBprsForErf(erfNumber)`: returns many (cardinality)
     - `getSprHistory({ customerName?, itemText? })`: history only
   - DTOs map **only** the columns needed. The column map lives in `pricing/columnMap.ts` and is confirmed with Cory and Gemma at M5.
   - Implementations: `Fake`, `SqlServer` (Route A) and `FabricSql` (Route B), selected by `PRICING_MODE`.
   - Parameterized queries only. A 10 s timeout, and results capped (50).
2. **API** (permission `quote.read.commercialFields`; Pricing/EngLead/Approver/Leadership/Admin):
   - `GET /api/v1/pricing/erf/:erfNumber`
   - `GET /api/v1/pricing/erf?customer=&q=`
   - `GET /api/v1/pricing/bpr/:bprNumber`
   - `GET /api/v1/quotes/:qn/pricing-context`: resolves `quote.erf_number`, pricing_record refs and the SF ERF number into the related ERF/BPR records
   - Cache 5 min in memory. `integration_run` counts per hour (not per call).
3. **UI:** a "Pricing context" panel on the Quoting tab and the Final Review summary:
   - ERF summary (dates, decision fields, elapsed-day fields)
   - linked BPRs (list)
   - SPR history (collapsed, labelled "Historical (SPR retired Nov 2025)")
   - a "Use as reference" button that adds the ERF/BPR number to the pricing_record refs

   Hidden entirely for roles without commercial access (server-enforced). Show a clear "Pricing app unavailable; enter references manually" state on errors.
4. **Linkage:** when an ERF number is chosen, set `quote.erf_number` if it's empty, and show a mismatch warning if the SF ERF number differs.

## Security
- A read-only DB login scoped to the views. The connection string or identity comes from Key Vault.
- Never log row contents. Redaction tests for every route.
- The sensitivity labels confirmed at M5 go into `policy/sensitivity.ts`.

## Tests
- Column-map unit tests with fixture rows (blanks → unknown).
- Fake-reader integration tests; route permission matrix; redaction.
- Optional live test behind `PRICING_LIVE_TEST=1`.

## Acceptance
- [ ] The Pricing user sees ERF/BPR context on the Quoting tab; KAM/Engineer get 403 on the routes and see no panel
- [ ] Manual-reference fallback works when the reader is down
- [ ] Tick B-15 in `docs/build-guide/03-build-steps.md`, recording the route chosen at M5 and the confirmed column map
