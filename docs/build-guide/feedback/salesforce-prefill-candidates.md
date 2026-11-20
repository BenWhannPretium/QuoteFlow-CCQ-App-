# Salesforce prefill: what the intake already inherits, and what we need Zachary to confirm

**Built:** 2026-11-19 (FB-32, N19-04; notes on N19-05 and N19-06) · **For:** Zachary Cairns (Salesforce), Graham Parle, Ben Whann · **Raised by:** Sarah Brennan (a KAM should not fill things in Salesforce and then again in QuoteFlow).

This is the list to take to Zachary. It covers **every question the intake asks** (read from the wizard, `apps/web/src/intake/Steps.tsx`, on 2026-11-19), says which ones QuoteFlow already fills from Salesforce, and names the Salesforce fields that **might** fill the rest. Nothing here is a decision: a "candidate" is a field that exists, whose meaning nobody has confirmed. QuoteFlow fills nothing from a field whose meaning is unknown, and writes nothing to Salesforce.

## How it was checked

- A **read-only describe** (field labels, types and picklist values only; no record was read) of `Opportunity_Product_Specifications__c`, `Opportunity`, `Product2` and `OpportunityLineItem` on 2026-11-19, through the Salesforce connector available to the build session. `Account` and `Quote` were not described. The describe is metadata: this page holds field API names, labels, types and picklist values, no customer, opportunity, price or person.
- Where a field is named below, its name is real (read from the org); what it **means** is not confirmed unless the status says so.
- The map of fields QuoteFlow reads lives in code (`packages/integrations/src/salesforce/fieldMap.ts`); the map of which Salesforce value feeds which question is `packages/domain/src/intake/sf-prefill.ts` (`PREFILL_MAP`). Adding a confirmed field is one entry in each (plus the DTO in `packages/contracts/src/sf-product-spec.ts`).
- `fieldMap.test.ts` forbids mapping any price, cost, margin, revenue or capital field. The org has several (for example `Capital_Estimate__c`, `Resin_Adjusted_Price__c`, `Project_Capital_Requirement__c`). They are **not candidates**: none is listed in the tables as a source to map. The one place a capital field is named, the tooling-funding row, says so.

## Status words

- **done**: filled from Salesforce today, tagged "from Salesforce", the KAM can change it, and a "Use the Salesforce value" link brings it back.
- **mapped but unused**: QuoteFlow already reads the field but nothing uses it, or uses it only as a hint.
- **candidate**: a field that exists and might feed the question once someone confirms the meaning.
- **no known source**: nothing found; the KAM enters it (it may genuinely be new information).

## Every question, one table

"Required?" is the seeded rule (`intake_required_fields`), which Admin can change; "needs a drawing or these" means required while no drawing is attached (`intake_min_spec_fields`). "Item" questions are asked once per item.

### Step 1 and 2: opportunity, customer, destination

| QuoteFlow question | Required? | Prefilled today? From which Salesforce field | Candidate Salesforce source | Status | Question for Zachary |
|---|---|---|---|---|---|
| Salesforce opportunity | yes | Picked by the KAM: `Opportunity` | | done | None. (N19-06: who may pick whose opportunity is Ben's decision, not this list.) |
| Customer | yes | `Opportunity.AccountId`, `Account.Name`; never typed | | done | None. |
| Not yet a Pretium customer (no ERP account) | no | No; the KAM's answer | Unknown: `Account` was not described | no known source | Does the Account carry a customer or ERP account number whose absence means "not yet established"? |
| Ship / fill destination (city, state, country; street, postal) | city and state | `Opportunity_Product_Specifications__c.Ship_To_City__c`, `Ship_To_State__c`, `Shipping_Country__c`, else `Account.ShippingStreet`, `ShippingCity`, `ShippingState`, `ShippingPostalCode`, `ShippingCountry`; the free text `Opportunity.Ship_to_Locations__c` is shown beside it and never parsed | | done (FB-24) | Which wins when the product's ship-to and the account's disagree (`ship_to_sources` order)? |
| Reason for changing the destination | when changed | No | | no known source | None: it is QuoteFlow's own control. |

### Step 3: the request

| QuoteFlow question | Required? | Prefilled today? From which Salesforce field | Candidate Salesforce source | Status | Question for Zachary |
|---|---|---|---|---|---|
| Request class (CCQ, Concept, Stock …) | yes (defaults to CCQ) | No | `Opportunity_Product_Specifications__c.Product_Type__c` and `Product2.Type__c` (label "Product Type" and "Type": Competitive, Non-Stock, NPD, RFP, Stock, Stock Plus, Stock Plus Extended); `Opportunity.Quote_Type__c` (label "Quote Source": SPR, ERF, Stock Bottle Price List, Price List; mapped as `quoteSource`, shown, not used) | candidate | Is "Product Type" the kind of request (stock, stock plus, new product)? If so does it decide CCQ versus the pricing application? |
| Assumptions for a concept | when Concept | No | | no known source | None. |
| Market | yes | No | `Opportunity.ParentMarket__c` (label "End Use Market", 30 values); `Opportunity_Product_Specifications__c.Parent__c` (label "Parent Market", 8 values) and `End_Use_Market__c` (label "End Use Market", the same 30 values); `Product2.Market_Use__c` (label "Market Use", multi-pick, 8 values). The product-record names promised on 2026-11-13 (W13-W10) are not among the ones described. | candidate | Standing question 1. |
| Sub-market | yes | No | The "End Use Market" fields above | candidate | Standing question 1. Is a Salesforce "End Use Market" QuoteFlow's sub-market and "Parent Market" its market? |
| Estimated annual revenue | no | `Opportunity.Amount` (left blank when flagged suspect) | | done | None. |
| Salesforce close date | shown | `Opportunity.CloseDate` (read-only, updates with Salesforce, not stored) | | done | None. |
| Quote needed by | yes | No | None found (`Opportunity.Date_Quoted__c` and `Date_RFP_Quote_Entry__c` record history, not a need-by date) | no known source | Does Salesforce hold when the customer needs the quote? |
| Quote variants requested (note) | no | No | | no known source | None. |
| Anything else (free text) | no | No | | no known source | None. |

### Step 3: each item

| QuoteFlow question | Required? | Prefilled today? From which Salesforce field | Candidate Salesforce source | Status | Question for Zachary |
|---|---|---|---|---|---|
| Item name | no | **New in FB-32:** item 1 from the first product specification's `Name`, else its `Capacity__c`, only while the KAM has typed nothing (items added from "Add from Salesforce products" always had it) | | done | Is the specification's `Name` (an auto-number) a name a KAM recognises? If not, which field is? |
| Product family | yes | No | `Opportunity_Product_Specifications__c.Finished_Good_Type__c` and `Product2.Finished_Good_Type__c` (label "Finished Good Type", text 60); not `Product_Type__c`, which is a kind of quote (see above) | candidate | Standing question 2. |
| Container size | no | `Opportunity_Product_Specifications__c.Capacity__c` (text) | Structured: `Capacity_Volume__c` (number) with `Capacity_Measure__c` (picklist: cc, gal, gram, in, kg, l, ml, mm, oz, qt, Lb); `Product2.Capacity__c` (picklist, 163 values) | done (text) | Is the text `Capacity__c` the same thing as volume plus measure? Which is kept clean? |
| Components (closure, liner, labels, decoration …) | no | No | | no known source | None known. |
| Liner spec, labels purchased by, decoration types, number of print colors | when the component is picked | No | | no known source | None known. |
| Resin | yes | `Opportunity_Product_Specifications__c.Resin_Type__c` (picklist: CP, CS, HDPE, HDPE/PCR, LDPE, PET, PET/PCR, PP, PS, PVC), matched to QuoteFlow's resin list | `Resin_Group__c` (text 60) | done | Is "HDPE/PCR" one resin or resin plus PCR? (QuoteFlow keeps PCR % apart.) |
| Customer-specified resin and grade | when ticked | No | | no known source | None. |
| PCR % | no | No | `Sustainable_Resin__c` (label "% Sustainable Resin", percent); `Change_PCR_Addition__c` (label "Change: PCR Addition": 100, 70, 50, 30, Other) | candidate | Is "% Sustainable Resin" the PCR content? Is "Change: PCR Addition" a change request or the spec? |
| Additive | no | No | `Change_Additive__c` (label "Change: Additive", text) | candidate | Is it the additive of the product, or a change request note? |
| Color | needs a drawing or these | **Hint only, switched off** (see below): `Opportunity_Product_Specifications__c.Color__c` (label "Color", text 255) | `Product2.Color__c` (picklist: Amber, Black, Clear, Clear/UV, White, Natural); `Custom_Color_Request__c` (boolean) | mapped but unused | Is `Color__c` the product's colour as the customer wants it? Which values mean "Natural", "Stock white", "Stock black"? |
| Neck diameter and finish; special feature | needs a drawing or these (neck) | `Opportunity_Product_Specifications__c.Neck_Finish__c` (picklist, 108 values), read as "28-410" and split into the lists | Structured: `Neck_Diameter__c` (number); `Product2.Neck_Finish__c` (picklist, 133 values), `Neck__c` (text), `Neck_Diameter__c` (number); `Opportunity.Neck_Finish__c` (text 20, older) | done | Standing question 1: which object holds the neck once the product is on the opportunity? |
| Height, width or diameter, depth | needs a drawing or these | No | `Height__c`, `Width__c` (numbers; no depth field found); unit not stated | candidate | What unit? Is `Width__c` a width or a diameter? |
| Gram weight | needs a drawing or these | No | `Weight__c` (number; `Product2.Weight__c` too); `Opportunity.Gram_Weight__c` (older) | candidate | Is `Weight__c` grams? Is it the target or the current part's weight? |
| Modify an existing mold; mold or part number; what changes | no | No | `Mold_Number__c` (text 20); `Product2.Mold_Number_txt__c`; `Legacy_Product_Code__c`, `Master_Product_Number__c`; the change notes (`Change_Weight__c`, `Change_Color__c`, `Change_Packout__c` …) | candidate | Do the "Change: …" fields mean the customer is modifying an existing product? |
| Packaging type; customer-specified packaging | no | No | `Carton_Type__c` (Bag, Box, Gaylord, RSC, Tier, Tray); `Pieces_Per_Pack__c`; `Line_Pieces_Per_Pack__c`; `Change_Packout__c` | candidate | Is a carton type the same question as QuoteFlow's packaging type (bagged, bulk, palletized, trayed)? Probably not. |
| Estimated annual volume | yes | `Opportunity_Product_Specifications__c.Line_Annual_Volume__c` | `Approved_Volume__c`; `Line_Annual_Volume_Per_M__c` | done | None. |
| Product needed by | yes | No | `Opportunity.EstimatedDateofFirstShipment__c` (label "Estimated Date of First Shipment"); on the specification `First_Production_Date__c`, `Product_Shipment_Start_Date__c`, `Production_Sample_Date__c` | candidate | Is "Estimated Date of First Shipment" the customer's launch need? |
| Standard description | no | Built by QuoteFlow from the answers | | done (generated) | None. |

### Step 3: commercial terms

| QuoteFlow question | Required? | Prefilled today? From which Salesforce field | Candidate Salesforce source | Status | Question for Zachary |
|---|---|---|---|---|---|
| Payment terms the customer requests | no | No | None found on the four objects described | no known source | Where, if anywhere, does Salesforce hold requested payment terms? |
| Does the customer fund any of the tooling? Customer share %; will the customer commit to the tooling | no | No | `Project_Capital_Requirement__c` says who pays for capital: **a capital field, so not a candidate** under the field rules | no known source | None. Capital stays out of the map until a business decision (CLAUDE.md rule 2 and the map's own rule). |
| Returnable dunnage | no | No | | no known source | None. |
| Inventory or safety stock requirements; for how long | no | No | `Change_Inventory_Program__c` (label "Change: Inventory Program": VMI, Safety Stock, Consignment) | candidate | Is it the customer's request, or a change to an existing program? Weeks are not held. |
| Delivered or FOB; freight type; special freight arrangements | no | No | None found on the four objects described | no known source | Where does Salesforce hold incoterms or freight? |
| Customer bid / RFP reference | no | No | None found (`Opportunity.Quote_Number__c`, text 10, looks like an internal quote number) | no known source | None. |

### Step 4: drawing, files and review

| QuoteFlow question | Required? | Prefilled today? From which Salesforce field | Candidate Salesforce source | Status | Question for Zachary |
|---|---|---|---|---|---|
| Drawing status; the drawing, render or photo | yes (drawing status) | No | `Customer_Signed_Drawing_Date__c` (on the opportunity and the specification) says a drawing was signed, not that one exists here | no known source | None. Files are not read from Salesforce. |
| Customer RFP / portal link | no | No | None found | no known source | None. |
| Comments for engineering | no | No | | no known source | None. |

## What the describe showed about the two unused fields

- **`Product_Type__c`, label "Product Type"**, picklist, 7 values: Competitive, Non-Stock, NPD, RFP, Stock, Stock Plus, Stock Plus Extended. The same list is `Product2.Type__c` (plus Accessory and Option). This reads as the **kind of product or request**, not a bottle family (jar, bottle, tube), which is what QuoteFlow's "Product family" asks. The synthetic fixture sets it equal to the family, which proves nothing. **FB-32 therefore adds no hint under Product family.** The closest QuoteFlow question is Request class (CCQ versus stock work that stays in the pricing application); matching these values to request classes would be a guess, so it is not built.
- **`Color__c`, label "Color"**, text (255), no picklist. `Product2.Color__c` is a picklist (Amber, Black, Clear, Clear/UV, White, Natural). QuoteFlow's Color list is Natural, Stock white, Stock black, Custom color. Only "Natural" can match exactly; "White" does not equal "Stock white" and is not offered. FB-32 builds the "Color in Salesforce says X. Use this" hint, **off**, for an exact match only (never "Custom color"), labelled with Salesforce's own label "Color".
- **Finished-good type** (Zachary, 2026-11-19) **exists**: `Finished_Good_Type__c`, text (60), on both `Opportunity_Product_Specifications__c` and `Product2`. It is not mapped: its values are unknown (no record was read) and nobody has said it means "product family".

**Recommendation for Ben and Zachary:** leave `intake_sf_suggestions_enabled` **off** until Zachary confirms two things: that `Color__c` is the product's colour (then the setting can go on for UAT with KAMs, since the hint is exact-match, never automatic and never written back), and what `Finished_Good_Type__c` holds (it, not `Product_Type__c`, is the better candidate for Product family, and would be a `fill` or a `suggest` entry in one line once its values are known).

## The three standing questions for Zachary

1. **Market, sub-market, container size and neck finish on the product record (W13-W10).** On 2026-11-13 you said Salesforce moved these from the opportunity to the product record (`OpportunityLineItem` or `Product2`: "parent market" and "end-use market"). The describe found: on `Opportunity_Product_Specifications__c`, `Parent__c` (label "Parent Market") and `End_Use_Market__c`; on `Product2`, `Market_Use__c`, `Capacity__c`, `Neck_Finish__c`, `Neck__c`, `Neck_Diameter__c`, `Capacity_Volume__c` and `Capacity_Measure__c`; on `Opportunity`, the older `ParentMarket__c` (label "End Use Market"), `Neck_Finish__c`, `Container_Capacity__c` and `Gram_Weight__c`. `OpportunityLineItem` holds none of them (it has `Product_Type__c`, `Sustainable_Resin__c` and `New_Weight__c`). **Which of these does the business keep current, and which one should QuoteFlow read for each of the four?**
2. **What `Product_Type__c` and "finished-good type" mean, and where they live.** `Product_Type__c` is a picklist of kinds of quote (Stock, Stock Plus, NPD, RFP …); `Finished_Good_Type__c` is a text field on the specification and on `Product2`. Is finished-good type the bottle family (jar, bottle, closure …)? What are its values? Is `Product_Type__c` what separates CCQ work from stock and price-list work?
3. **Where the KAM-to-sales-leader reporting structure is kept (N19-05), and whether QuoteFlow needs it.** Today QuoteFlow has none: roles come from Entra, a Sales Leader sees all quotes, and Salesforce's `User` and `ManagerId` are never read. Is the reporting line kept in Salesforce (`User.ManagerId`, a role hierarchy, a team), or somewhere else? Should QuoteFlow read it?

## Not decided here (for Ben)

**May a KAM start a quote on another KAM's opportunity?** (N19-06.) Darren Miller said they may not. A scope setting would not stop it: today the picker's "Mine" is a search filter and nothing checks the opportunity's owner against the person starting the quote. Enforcing it needs a new server-side check and a rule for matching a Salesforce owner to an Entra user. That is a policy and security decision and it is not part of FB-32.
