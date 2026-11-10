# FB-13: Plants and machine types (tracker F-057)

Saved from the build prompt of 2026-11-10. Input record: `docs/build-guide/feedback/inputs/plants-machine-types.md`.

You are working on QuoteFlow (CCQ), repo BenWhannPretium/QuoteFlow-CCQ-App-. Read CLAUDE.md first, then
docs/build-guide/01-architecture.md. Branch off the latest origin/main (5c02454 or newer). Use a new branch
named claude/fb-13-plants-machine-types and open a draft PR when pushed.

BUILD STEP: FB-13, plants and machine types (tracker item F-057). Also save this prompt as
docs/build-guide/prompts/feedback/FB-13-plants-machine-types.md and add an FB-13 row and section to
docs/build-guide/03-build-steps.md.

## SOURCE AND AUTHORITY

Jim Zweifel sent the list on 2026-11-10 (QuoteFlow Plants and Process.xlsx, dated 11.10.26). Ben Whann
confirmed it is correct. Treat it as the approved source. Load it exactly as sent. Do not question,
"fix" or drop anything in it (this includes "12B" at St. Charles and the spelling "Etten.Leur"). Do not
add a plants-count check against the old "about 29" figure; the list has 22 locations.

Save the data as docs/build-guide/feedback/inputs/plants-machine-types.md (source, date, approver, the
table below). Never commit the spreadsheet itself.

```
LOCATION | PROCESS / MACHINE TYPES (as sent)
Aurora | EBM
Bethlehem | EBM, IBM, ISBM
Boxmore | EBM, IBM, INJ - CAP, PAD PRINTING
Carrollton | EBM, ISBM, RHB
Cleveland, OH | EBM, INJ - PREFORM, RHB
Cleveland, TN | IBM, INJ - OTHER
Lerma, Ediplast | EBM, INJ - PREFORM, ISBM, RHB, DECO
Lerma, Ediprint | DIE CUTTING, LAMINATION, PRINTING, STAMPING
Etten.Leur | ISBM, RHB
Greensboro | EBM
Hazleton | ISBM, RHB
Hillsborough | IBM, ISBM, INJ - CAP, INJ - OTHER
Leipsic | EBM
Manchester | EBM, ISBM
Peru | ISBM
Salt Lake City | EBM, IBM, ISBM, RHB
St. Charles | 12B, INJ - CAP, ISBM, RHB, DECO
St. Laurent | EBM, IBM
St. Louis | IBM, INJ - CAP, ISBM
Toronto | EBM, IBM, INJ - OTHER
Troy | EBM, RHB
Vancouver | EBM, IBM, ISBM
```

## WHAT TO BUILD

1. **Plant list** (value list key `plant`, seed in packages/db/seeds/config/value-lists.ts):
   - Replace PLANT_01 to PLANT_03 with these 22 locations. Codes are stable upper-snake of the name
     (AURORA, CLEVELAND_OH, LERMA_EDIPLAST, ETTEN_LEUR, ST_CHARLES, ...); labels are the names as sent.
   - Each plant keeps its list of machine types in the value's `meta` (follow the existing meta
     pattern, e.g. freeText, delivered, market). The list is data, not code.
   - Mark the plant list approved: provisional = false, approved_at = 2026-11-10,
     meta.approvedByName = 'Jim Zweifel'. approved_by is a uuid FK to app_user, so leave it null (same
     as FB-09 for Danielle's lists; read migration 0036 and packages/db/seeds/config/value-lists.ts
     APPROVED_VALUE_LISTS and follow that mechanism).
2. **Machine types** (value list `machine_type`, today a placeholder: EBM_SHUTTLE, EBM_WHEEL, IBM_PRESS,
   ISBM_1STEP, ISBM_2STEP, INJECTION_PRESS, OTHER):
   - Replace it with Jim's codes: EBM, IBM, ISBM, RHB, INJ-CAP, INJ-PREFORM, INJ-OTHER, DECO, PAD
     PRINTING, 12B, DIE CUTTING, LAMINATION, PRINTING, STAMPING. Keep his labels as sent.
   - Before you change anything, read how `machine_type` and `process_type` are each used (the G2
     required check `present('machine_type')` in packages/domain/src/workflow/seeds/hybrid.ts, the
     Engineering Review form, the FB-06 routing rules in packages/domain/src/engineering/
     assignment-rules.ts which key on `process_type` codes ISBM, RHB, IMM, EBM, IBM). Decide the
     smallest change that works and write it down in the build notes. Likely: machine_type becomes
     Jim's list; process_type is left alone; INJ-CAP, INJ-PREFORM and INJ-OTHER are treated as the
     injection process (IMM) for routing, via data where possible, so the FB-06 suggestion still works.
     Do not change who gets suggested.
3. **Where a plant is picked** (Engineering Review site, preform plant, blow plant, pricing app reader
   `plant`), the dropdown now shows the 22 locations. Do not add machine-type filtering to the pickers
   unless it is trivial; if you think it is worth doing, say so in the PR instead of building it.
4. **Retire, never delete:** PLANT_01 to PLANT_03 and the old placeholder machine types become inactive
   (follow FB-09 and migration 0036: old quotes keep their code and show "(no longer offered)").
   Update the synthetic and demo seeds (packages/db/seeds/synthetic/*) that reference PLANT_01 and old
   machine types so they use the new codes.
5. **Migration 0039** (check `ls packages/db/migrations` first; renumber if main has moved): hand-written
   data migration that adds the new values and retires the old ones in existing environments. It must
   be idempotent, leave an Admin-edited or already-approved row alone, and follow the style of 0036 and
   0037. Update meta/_journal and the snapshot the way drizzle-kit does.
6. **Read-only report:** extend `pnpm --filter @ccq/db fb09:report` (it already lists placeholder plants) so
   it shows quotes still on retired plant or machine-type codes with the suggested new value. Do not
   remap any real quote.

## NON-NEGOTIABLES (from CLAUDE.md)

- Rule 4: no hard-coded business rules; these are config rows.
- Rule 10: the schema stays mirror-safe for Fabric. If you add any jsonb or array column, follow the
  `_json text` companion pattern and register it in packages/db/src/fabric.ts. Prefer using existing
  `meta`. Run the guard tests (fabricCompat, fabricTwins, test/fabric.int.test.ts).
- No real customer data. The plant list is not customer data and may be committed.
- Do not touch the live scoring model, gates, or permissions.

## TESTS

- Domain unit tests for anything with logic (the injection to IMM mapping, if built).
- DB integration: migration 0039 (adds, retires, idempotent, leaves Admin-edited and approved rows
  alone, empty-DB no-op), seed tests, the report.
- API integration: a quote can be created and an Engineering Review saved with a new plant and machine
  type; a retired code is still readable on an old quote; the FB-06 suggestion still returns the same
  engineer for ISBM, RHB, IMM, EBM and IBM.
- Playwright: the Engineering Review shows the new plants and machine types. Update any existing spec
  that selects PLANT_01 or an old machine type.
- Run lint, typecheck, unit, integration and build. Node 22 is required; if the machine has another
  version, say so in the PR and let CI be the check.

## DOCS (CLAUDE.md rule 11)

- 03-build-steps.md: tick the FB-13 checklist and note deviations.
- 04-decisions-and-risks.md: record the plant and machine-type list as received from Jim Zweifel,
  2026-11-10, approved; mark F-057 done.
- 01-architecture.md and the data dictionary (`pnpm db:dictionary`) if anything changed.
- UAT: add the plant and machine-type checks to docs/uat/scripts/engineering.md (and intake if a plant is
  chosen there); update quick-starts only if their screenshots or labels name the old values.
- docs/build-guide/feedback-change-log.md and docs/build-guide/feedback/QuoteFlow Change Log.csv: add
  the F-057 row with the PR link.
- docs/build-guide/05-path-to-mvp.md: update the row.

## PR

Conventional commit (feat(plants): ...). Draft PR. Fill the repo's PR template. Include: before and
after of the dropdowns, deviations, the mapping decision, test evidence, and "Provisional values
awaiting sign-off: none (list approved by Jim Zweifel 2026-11-10)". Do not include any model name in
commits or the PR.
