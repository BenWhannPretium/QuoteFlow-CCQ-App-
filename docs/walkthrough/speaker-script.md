# QuoteFlow walkthrough: speaker script

> Checked against the build on 2026-11-17 (pre-release audit): labels, navigation and flows corrected to the screens after FB-15 to FB-20; the "Hidden" beat removed (every role that can read a quote now sees its figures); segments added for multi-item quotes, the four decision choices, the Production Scheduler, Finance and the offer letter.

One core script, four audience modules. Word-for-word. Demo runs locally in `AUTH_MODE=dev` on synthetic data, switching personas with the yellow **DEV** bar.

> **Status of this draft.** Written from the UAT scripts (`docs/uat/scripts/`), the landing definitions and the seed data, then checked on 2026-11-17 against the web source (`apps/web/src`), the Playwright specs (`apps/web/e2e`) and the seeded configuration. Labels and button names are copied from those. It has not been rehearsed against a running build. Do one full dry run and fix any button name that has drifted. Stage, gate and reason-code labels are provisional configuration, so a different wording on screen is fine.

**How to read this file**

- `SAY:` is spoken aloud, word for word.
- `DO:` is what you click. Don't read it out.
- `[PERSONA: x]` means pick `x` in the DEV bar's **Persona** dropdown.
- `[MODULE]` marks where an audience module plugs in.
- `FILL:` tables list what to type or pick on each form. Everything uses one running example, a **16 oz HDPE bottle** for a household-cleaner line, so the story stays consistent from intake to hand-off. Dropdown values are exact names from the seeded option lists. Free-text values are invented. Don't use real customer details.
- Don't enter an annual volume of exactly 1,000,000 (or any whole multiple of it). The app treats that as a default and shows a "Is this the customer's real annual volume?" prompt. The table uses 750,000.
- A field Salesforce supplied shows read-only with a Salesforce tag. Leave it as it is and fill the rest.

---

## 0. Before you present

### Set up (about 10 minutes, the day before and again 30 minutes before)

```bash
cp .env.example .env            # AUTH_MODE=dev, SF_MODE=fake, MAIL_MODE=fake
pnpm i
docker compose up -d db
pnpm db:migrate && pnpm db:seed --synthetic
pnpm dev                        # open http://localhost:5173
```

Check, in this order:

1. The yellow **DEV** bar shows at the very top, with a **Persona** dropdown on the right.
2. Pick `kam`. **My quotes** loads under the eyebrow **Command Center · Key account manager**, with blocks filled in (the seed holds 150 quotes spread across every stage).
3. **New intake** finds opportunities in the search box (the fake Salesforce is built from the same synthetic data).
4. Browser zoom 125%. Close Slack and email. Hide bookmarks.
5. Keep a second tab on `http://localhost:3000/docs` (the API docs) in case someone asks.
6. Have three small `.xlsx` files ready, with no real figures in them: one to upload as the equipment BOM, one as the costing model, one as the payback model. A workbook QuoteFlow cannot read is still stored; the step then says **Summary unavailable**.

### Persona cheat sheet

| Beat | Persona key | What it shows |
|---|---|---|
| Intake | `kam` | **My quotes**, **New intake** |
| G1 qualify | `sales-leader` | **To qualify**, **Decide** |
| Engineering queue and G2 | `eng-lead` | **Engineering queue**, **Assign engineer**, **Decide feasibility** |
| Engineering work | `engineer` | **My assignments**, solution, equipment BOM |
| Capacity | `production-scheduler` | **Capacity requests**, capacity evidence, **Approve capacity** |
| Pricing triage and G3 | `pricing-lead` | **Pricing queue**, **Assign pricer**, **Decide price approval** |
| Pricing | `pricing` | **Quoting** tab, costing model, price approval record |
| Payback | `finance` | **Payback requests**, the payback model upload |
| Final Review | `approver` | **Approvals**, **Review & decide** |
| Overview, audit | `leadership` | **Command Center** (**My work**, **Analytics**), **Admin → Audit log** |

Other personas, if a question calls for them: `kam-owner` (sees only their own quotes), `kam-region` (West only), `engineer-owner`, `multi-role` (Sales leader and Approver, with role tabs), `admin`.

### If something goes wrong

- A persona switch doesn't change the page: reload the browser tab.
- The live quote stalls at a step: say "I'll jump to one we prepared earlier" and open any quote already in that stage from **Pipeline** (the seed has 22 in Engineering & Capacity, 18 in Quoting and 10 in Final Review).
- A button is missing: you are probably on the wrong persona. Check the DEV bar. On the Engineering and Quoting tabs the button that moves a quote forward appears only once the work it needs is filled in; until then the tab offers **Send back, hold or stop** and lists what is still needed.
- Never apologise at length. One sentence, then move on.

---

## 1. Core script (about 36 minutes)

### 1.1 Opening `[MODULE: opening, about 2 min. Swap in the audience hook from section 2.]`

### 1.2 What QuoteFlow is (2 min)

DO: Start on `kam`, **My quotes**. Point at the DEV bar.

SAY: "Before I start, one housekeeping point. The yellow bar at the top is a demo tool. It lets me sign in as different roles on my laptop. In the real app you sign in with your Microsoft account and your role comes from your security group. Everything you see today is synthetic data. There are no real customers in here."

SAY: "QuoteFlow replaces the old ERF application for new-business quotes that need engineering input or capital. Its job is simple. One governed place where a quote goes from intake, to engineering, to pricing, to final approval, to the customer's answer, and every step has an owner and a record."

SAY: "Three ideas to hold on to. First, Salesforce is the front door. Every quote starts from a Salesforce opportunity. Second, the server decides which quotes you can open and what you may change or decide. Third, everything is recorded. I'll show you all three."

### 1.3 Intake, as the KAM (5 min)

DO: **New intake**. Step 1, **Opportunity**. Type part of an opportunity name in **Find the Salesforce opportunity**. Leave **Mine** selected.

SAY: "A KAM starts by finding their own Salesforce opportunity. The details come straight from Salesforce: name, account, amount, close date, owner. I'm not retyping any of it."

FILL (step 1, Opportunity):

| Field | Enter |
|---|---|
| Find the Salesforce opportunity | Type the first few letters of any open opportunity in the list. Keep **Mine** selected, and pick one that has no **Has quote CCQ-…** badge |

DO: Click **Use this opportunity**. Step 2, **Customer & destination**.

SAY: "The customer is the Salesforce account on the opportunity. If it isn't a Pretium customer yet, I tick one box. There is deliberately no way to create a customer account here. That stays in the system that owns it."

FILL (step 2, Customer & destination). Nothing to type when Salesforce has the address. If Salesforce has no city or state, the step asks for it (both are required). To demo a destination change instead, click **Change destination** and use:

| Field | Enter |
|---|---|
| Street | 1200 Commerce Pkwy |
| City | Aurora |
| State / region | IL |
| Postal code | 60504 |
| Country | USA |
| Reason for changing the destination | Customer ships from its regional distribution centre |

DO: Point at **Ship / fill destination**. Click **Next**. Step 3, **Request & items**. Fill the fields quickly. A red asterisk marks every field needed to submit.

FILL (step 3, Request & items: the request, entered once):

| Field | Enter |
|---|---|
| Request class | CCQ (new business + capital/engineering) |
| Market | Home Care |
| Sub-market | Cleaning Supplies |
| Estimated annual revenue (USD) | 1800000 |
| Quote needed by | About 30 days out (must be after today) |
| Anything else (free text) | New 16 oz HDPE bottle, 28-410 finish, for a household-cleaner line |

FILL (step 3, the item):

| Field | Enter |
|---|---|
| Item name (optional, e.g. 16 oz bottle) | 16 oz bottle |
| Product family | Bottle |
| Container size | 16 oz |
| Components (tick) | Container, Closure |
| Resin | HDPE |
| Neck diameter | 28 mm |
| Neck finish | 410 |
| Special feature | CT (continuous thread) |
| PCR % | 0% / Virgin |
| Color | Natural |
| Height (mm) | 190 |
| Width or diameter (mm) | 65 |
| Depth (mm) | 65 |
| Gram weight (g) | 28 |
| Packaging type | Palletized-custom |
| Customer-specified packaging (describe) | Palletized, 12 cases per layer, max height 60 in (if the field shows) |
| Estimated annual volume (units) | 750000 |
| Product needed by (best estimate of launch need) | About 120 days out (after **Quote needed by**) |
| Standard description | Click **Use suggestion** |

What blocks a submit (provisional configuration): the opportunity, the customer, the destination city and state, **Market**, **Sub-market**, **Product family**, **Resin**, **Estimated annual volume**, **Quote needed by** and **Product needed by**; and, for each item, a drawing or the minimum spec (height, width or diameter, depth, gram weight, neck, resin, color). Everything else is advisory. To show a blocked submit, leave **Gram weight (g)** empty.

SAY: "Every field has a one-line reason for why we ask, and the red asterisk tells me what I must fill in. And notice what the KAM is not asked: plant, engineer, priority. Those aren't the KAM's decisions."

### 1.3b More than one item on a quote (about 1 min, not rehearsed)

DO: In the **Items** panel, click **Duplicate** on item 1. Change **Item name** to `16 oz bottle 25% PCR` and **PCR %** to **25%**. Point at **Add item** and, when the opportunity has more Salesforce products, **Add from Salesforce products**. To keep the rest of the demo short, click **Remove** on the copy and confirm.

SAY: "A bid for several items is one quote. Each product, or each variant such as another PCR level, is its own item with its own product fields, volume and drawing. Engineering works each item, and the quote moves through the gates as one."

DO: **Next**. Step 4, **Drawing, files & review**. Set **Drawing status** to **None (quote will take longer)**. Point at **Minimum spec complete**. Show **Engineering may ask about this**.

FILL (step 4, Drawing, files & review):

| Field | Enter |
|---|---|
| Drawing status | None (quote will take longer). To show an upload instead, pick **Have drawing** and drop any small PDF |
| Customer RFP / portal link (optional) | Leave blank |
| Comments for engineering | No drawing yet. Customer will send CAD after kickoff. Target launch Q3 2027. Please confirm EBM capacity. |

SAY: "With no drawing, the minimum spec I filled in is enough for engineering to start. If something optional is missing, I'm told up front what engineering may come back on, and I can still submit. If it's a hard requirement, the page lists exactly what's needed before I can submit, each with a Fix link."

DO: Type the **Comments for engineering** from the table. Click **Submit to CCQ**.

SAY: "And that's the intake. The system generates the quote number. That number follows this quote everywhere."

DO: Click **Open the quote**. Point at the quote number, stage **Intake**, priority tier, **Why this priority?**, the tabs (**Overview**, **Engineering**, **Quoting**, **Attachments**) and the **Timeline**. **Write the quote number on a sticky note. You'll look for it again later.**

SAY: "The priority is a score, and it's advisory. It orders the work. People decide."

### 1.4 G1: qualify and prioritise, as the Sales leader (3 min)

DO: `[PERSONA: sales-leader]`. Click **To qualify**.

SAY: "The first gate belongs to a sales leader. Submitted intakes, highest priority first. The score orders the list and the leader makes the call."

DO: Click **Decide** on your quote (or open it and click **Qualify quote**). Hover an ⓘ. Show the four choices: **Advance**, **Send back to…**, **Hold**, **Stop**. Under **Stop** there are two: **Stop: not CCQ work (send elsewhere)** and **Stop**.

SAY: "Every gate asks the same four plain questions: advance it, send it back, hold it, or stop it. Each has a definition. A send-back says who it goes to, with a reason and a note saying what to fix. A hold needs a reason, a review date and an owner. A stop needs a reason and a note. This is what stops quotes sitting in limbo."

DO: Choose **Advance** and click **Record decision**.

SAY: "Advance. The quote leaves this list and lands in Engineering and Capacity. One more rule I like: a sales leader cannot qualify an opportunity they own as KAM. The system enforces it."

### 1.5 Engineering (6 min)

DO: `[PERSONA: eng-lead]`. Click **Engineering queue**.

SAY: "Engineering sees every quote in this stage, highest priority first. The columns tell the lead what they need to assign well: product, resin, volume, how long it has waited, whether there's a drawing."

DO: Open the row menu (**…**) on your quote, then **Assign engineer**. Pick an engineer. Under **Production scheduler (optional)** pick the scheduler (or click **Use it** on the suggestion). **Assign**.

SAY: "The lead assigns an engineer, with each engineer's open count visible, and can name a production scheduler for the capacity part. Both are notified."

DO: `[PERSONA: engineer]`. **My assignments**. Open your quote, **Engineering** tab, **Start review**.

SAY: "The engineer starts the review. Plant first, then one pick for process and machine type, limited to what that plant runs. Then cavitation, cycle time, a budgetary capital estimate, tooling, technical concept."

FILL (**Engineering** tab, Solution):

| Field | Enter |
|---|---|
| Plant / site | Aurora |
| Process & machine type | EBM (the process shows read-only, set by this pick) |
| Cavitation | 4 |
| Cycle time (s) | 12 |
| Budgetary capital estimate (USD) | 450000 |
| Tooling notes (mold, hot runner) | New 4-cavity mold set. Standard neck insert for 28-410. |
| Technical concept | 4-cavity EBM, 16 oz HDPE bottle, about 28 g, existing 28-410 tooling family |
| Supply Chain | HDPE from the existing resin contract. No new supplier needed. |

DO: Click **Save solution**. Point at **Progress saved** beside the button. On the **Equipment BOM** card click **Upload the equipment BOM** and pick your BOM file.

SAY: "There is no yes-or-no capital question. Capital is needed when the engineer's capital estimate is above zero dollars. Then the equipment BOM has to be on file before the quote can advance, and Pricing and Finance pick it up from there."

### 1.5a The Production Scheduler (about 1 min, not rehearsed)

DO: `[PERSONA: production-scheduler]`. **Capacity requests**. Open your quote, **Engineering** tab. Point at **Engineer’s part** on the Solution card and **Your part** on the capacity cards. Click **Add capacity row**.

FILL (Capacity evidence row):

| Field | Enter |
|---|---|
| Site | Aurora |
| Line / asset | EBM-07 |
| Assumed effectiveness % | 82 |
| Cycle time (s) | 12 |
| Utilization before % | 78 |
| Analysis date | Today |
| Analyst | Pick any name in the list |
| Notes and assumptions | Assumes 82% effectiveness, 3 shifts, 5 days. Covers changeovers. |

DO: Click **Save capacity evidence**. Point at **Utilization after % (calculated)**. On the **Capacity sign-off** card click **Approve capacity**.

SAY: "Capacity has its own owner. The production scheduler enters how loaded the line is today, QuoteFlow calculates the utilization with this business added, and the scheduler approves capacity or blocks it with a note. A block sends the work straight back to the engineer, who is told why. The scheduler can read the solution but can't change it."

DO: `[PERSONA: eng-lead]`. Open the quote, **Engineering** tab. Click **Decide feasibility**, choose **Advance**, **Record decision**. (If capacity is not signed off yet, the dialog offers the lead a **Capacity approved (I’m signing it off)** box instead.)

SAY: "The engineer can submit the finished review to the lead, and the lead can decide at any time. Capacity needs a sign-off before the gate can move, and the dialog tells you what's missing if you try too early. At this gate the lead can advance, advance with risk, send it back to the KAM or to Engineering, hold it or stop it."

### 1.5b Pricing (6 min)

DO: `[PERSONA: pricing-lead]`. **Pricing queue**.

SAY: "The quote is now in Quoting. The pricing lead sees the whole queue, with counts for awaiting price approval and capital pending, and assigns it to a pricer."

DO: Row menu, **Assign pricer**, pick a pricer, **Assign**.

DO: `[PERSONA: pricing]`. Open the quote. **Quoting** tab.

SAY: "The pricer sees the engineering summary right next to the pricing record: plant, process, capital, capacity evidence. No chasing emails."

DO: Show the **Pricing history** card.

SAY: "Pricing history comes from the retired pricing app's export, loaded by an admin. It is read-only. QuoteFlow shows it, it never edits it."

DO: Point at the three steps: **Costing**, **Payback**, **Price approved**. On **Costing**, click **Upload the costing model** and pick your costing file.

SAY: "Quoting runs in order. Costing first: the pricer uploads the costing model, and the file lives on the quote with its versions. Then payback, when capital is needed. Then the pricing lead approves the price."

FILL (**Quoting** tab, Price approval record):

| Field | Enter |
|---|---|
| Legacy ERF # | Leave blank, or ERF25-123 (invented; the format is checked) |
| Costing completed (Cost-to-Serve) | Ticked for you when the costing model is uploaded |
| Approved by | Defaults to you |
| Approved at | Now |
| Pricing basis | Cost-to-serve plus standard margin target. Resin indexed to contract. |
| Approved negotiation range | Within the approved band. Walk-away at the floor set by the pricing lead. |

Keep the wording about price qualitative. The record has no price field, and it keeps the demo clear of real figures.

DO: Click **Save price approval**.

SAY: "Here's a deliberate design choice. There is no field to type a price. Costing happens in Excel and the pricing application, which stay the systems of record. QuoteFlow keeps the costing workbook and records that costing was completed and who approved the price."

FILL (Capital readiness):

| Field | Enter |
|---|---|
| Status | Capital pre-approved (budgetary). Engineering said capital is needed, so **Capital not required** is blocked |
| Capital notes | Mold set funded under the FY27 capital plan |

DO: **Save capital readiness**.

### 1.5c Finance and the payback model (about 1 min, not rehearsed)

DO: `[PERSONA: finance]`. **Payback requests**. Click **Find a quote**, open your quote, **Quoting** tab. On step 2, **Payback**, click **Upload the payback model** and pick your payback file.

SAY: "When capital is needed, Finance is told as soon as Pricing has uploaded its costing model. Finance downloads it, builds the payback model on its own template and uploads it here. QuoteFlow shows a short read-only summary of the workbook's headline figures. Finance is an input, not an approver, and can change nothing else on the quote."

DO: `[PERSONA: pricing]`. Open the quote, **Quoting** tab. Click **Submit to pricing lead**.

DO: `[PERSONA: pricing-lead]`. Open the quote, **Quoting** tab. Click **Decide price approval**, choose **Advance – price approved**, **Record decision**.

SAY: "The pricer submits to the pricing lead, and only the pricing lead approves the price. To go forward, the costing model must be on file, the payback model too when capital is needed, costing attested and capital readiness confirmed. Try to skip one and the dialog lists what's missing. That's the point of a gate."

To show the commercial terms: on the quote's **Overview** tab, the **Terms** card takes **Payment terms** (Net 30; anything other than Net 15 or Net 30 is flagged non-standard and asks the pricing lead to decide), **Customer tooling commitment** (No) and the **Terms checked** box, then **Save terms**.

### 1.6 Who sees what, and who decides (2 min)

DO: `[PERSONA: kam]`. Open the same quote, **Quoting** tab.

SAY: "Now the same quote as the KAM. I can read the price approval record, the capital position and the engineering figures. That is deliberate: nobody is hidden from data on a quote they can open. What I don't have is any way to decide on them. There is no Assign and no Decide for me on the Engineering tab, and the price is the pricing lead's to approve."

DO: `[PERSONA: kam-owner]`. **Pipeline**. Point at the shorter list. Then `[PERSONA: kam]` again.

SAY: "What differs by person is which quotes you can open. This KAM sees only their own. Another sees one region. That scope is enforced on the server and again in the database, not by hiding rows on the screen."

DO: Type `/approvals` after the address.

SAY: "And if a KAM guesses the address of a page they shouldn't have, they get 'You don't have access to this'. The server decides, not the menu."

### 1.7 Final Review (3 min)

DO: `[PERSONA: approver]`. **Approvals**. Click **Review & decide** on your quote.

SAY: "Final Review is the approver's gate. Everything they need on one page: the request and its items, the priority, the engineering solution and capacity evidence, the price approval, the costing and payback models, capital readiness, the files and every earlier decision."

DO: Click **Advance (release the offer)**. Show the dialog text (an internal decision, **Proposal issued**, the valid-until date). **Record decision**.

SAY: "Approving here is internal. It releases the proposal to the customer. It does not award the quote. The proposal gets a valid-until date, and you'll see that matter in a minute. And two guard rails: an approver can't decide a quote where they're the KAM, or where they approved the price."

### 1.7b The offer letter (about 1 min, not rehearsed)

DO: `[PERSONA: kam]`. **My proposals**. On your quote's card, follow the offer letter link to the **Offer letter** card on the quote. Point at the **DRAFT: wording not yet approved by Legal** banner, **What the letter will print**, **Attention**, the **Part #** field for each item and **Generate Word document**.

SAY: "Once Final Review has released the offer, the KAM can generate the customer's offer letter here as a Word document, one letter per quote with a row per item. The prices are not typed. They are read from the costing workbook on the quote and cannot be edited here. The wording is still a draft until Legal approves it, and the letter says so."

In a local demo expect the card to read **The offer letter cannot be generated yet:** with the reasons (not verified from the source: the prices come from a costing workbook in a layout QuoteFlow is set up to read, and the build notes say that mapping is not switched on yet). Check it at the dry run, show the card and say so. To show finished letters, run `pnpm --filter @ccq/api offer-letter:sample <folder outside the repo>` beforehand; it writes synthetic sample letters. Before Final Review the card reads **Not available yet**.

### 1.8 Customer decision and hand-off (4 min)

FILL (Record outcome, to show an award):

| Field | Enter |
|---|---|
| Outcome | Awarded |
| Acceptance evidence | Purchase order (PO) |
| Customer accepted on | Today (a future date is refused) |
| Document link | https://example.com/po/12345 (invented) |

To show a loss instead: **Lost**, reason **Price**, competitor `Competitor A`.

DO: `[PERSONA: kam]`. **My proposals**. Click **Record outcome** on your quote, fill the table, **Record decision**.

SAY: "The customer answers, and the KAM records it. Awarded, in negotiation, lost, or no response. Lost needs a reason code, and silence is not a loss: an expired proposal is recorded as expired. That feeds the reasons chart you'll see in a moment."

DO: Open the quote. Show the stage **Commit & Hand Off**. Click **Commit and hand off**, choose **Advance (close Won)**. Show **Missing before it can move on**. Close the dialog.

SAY: "Awarded does not mean closed. The deal is closed won only after the capital approval is recorded, or marked not required, and the receiving team accepts the hand-off. So we don't lose deals in the gap between a yes and actual production."

FILL (**Commit & hand off** card):

| Field | Enter |
|---|---|
| CER status | Approved |
| CER ID (Apex) | APX-2026-0457 (invented) |
| CER approved on | Today |
| Receiving role | Commercial Activation (or the closest option) |
| Receiving contact | Dana Reyes (synthetic name) |
| Accepted-by date | Today |
| Hand-off accepted by the receiving team | Tick |

DO: Click **Save hand-off**, then **Commit and hand off**, **Advance (close Won)**, **Record decision**.

### 1.9 Leadership view and the audit trail (4 min)

DO: `[PERSONA: leadership]`. **Command Center**.

SAY: "Leadership gets the whole picture. Open quotes, median time from intake to the Final Review decision, how complete intakes are first time, and win rate shown next to outcome capture rate. We show them together because a win rate means little if outcomes aren't being recorded."

DO: Click **Analytics** in the page header (the switch beside **My work**). Open an ⓘ.

SAY: "Every chart has a definition and a time window. Holds are excluded from cycle time, and the footer is honest that these are operational metrics, not yet certified by Data and Analytics."

DO: **Admin**, **Audit log**. Filter **Quote** by the number on your sticky note.

SAY: "And here is our quote. Every view, stage change, gate decision, override and export is written to an append-only audit log, with who, what and when. Nothing can be edited or deleted. Anyone who looked at this quote is on this list, including me just now."

DO: **Admin → Override log**.

SAY: "Overrides, like a changed priority or destination, need a reason and are logged with the original value. Leadership and admins can read it, nobody can quietly change history."

### 1.10 Close `[MODULE: close, about 2 min. Swap in the audience close from section 2.]`

---

## 2. Audience modules

Each module has three parts: the **opening** (replaces 1.1), the **emphasis** (what to linger on and what to trim, inside the core) and the **close** (replaces 1.10).

### 2.1 KAMs

**Opening (about 90 seconds)**

SAY: "Thanks for the time. I know you already have a lot of tools, so I'll start with what changes for you. You still start from Salesforce. You'll fill in one guided intake instead of an ERF. After that you can see where every quote of yours stands without emailing anyone, and you get told when something needs you. I'll show you the full path of one quote, because it helps to know what happens after you hit submit."

SAY: "Please stop me whenever something looks different from how you really work. That's the most useful thing you can tell me."

**Emphasis**

| Section | Do |
|---|---|
| 1.3 Intake | **Linger (+3 min).** Show the draft behaviour (leave **Gram weight (g)** empty, point at **Needed before you can submit** and its **Fix** link), a destination change with its reason, and **Have drawing** vs **None**. Show **Continue a draft**. |
| 1.3b Items | **Keep.** Show **Duplicate** for a variant and **Add item**. |
| 1.4 G1 | Add the send-back loop: have the sales leader choose **Send back to…** (it goes to **The KAM (fix the intake)**), switch back to `kam`, show **Returned to me**, the banner and **Fix and resubmit** with the same quote number. |
| 1.5, 1.5b | **Trim to 1 min each.** "Engineering and Pricing do their work here, and you can see the stage and who has it on your quote." |
| 1.6 | **Keep and explain gently:** "You can read the engineering and pricing records on your own quotes. You can't change them." |
| 1.7b, 1.8 | **Linger.** This is their gate. Show **My proposals**, the validity dates, the offer letter card, **Record outcome** and the reason codes. |
| 1.9 | **Trim to 1 min.** Show only **My outcome capture rate** and the **On hold** chip on their Command Center. |

**Close**

SAY: "So for you: one intake, no retyping Salesforce, a clear view of every quote, and a place to record the customer's answer. The one thing I need from you is the outcome. When a customer says yes, no or nothing, record it. That is what lets us learn why we win and lose. What did I miss in how you actually quote?"

### 2.2 Engineering

**Opening (about 90 seconds)**

SAY: "I'll show you how work reaches engineering, how you'd review it, and what happens after you hand it back. The headline: you get a prioritised queue with the drawing, product, resin and volume in front of you, one place to record the solution and the capacity evidence, and a clear decision at the end that says what happens next. I want your honest view on whether the fields match how you really assess a job."

**Emphasis**

| Section | Do |
|---|---|
| 1.3 Intake | **Trim to 2 min.** "This is what the KAM fills in. Notice it asks for resin, the neck and packaging, and needs a drawing or a minimum spec for every item." |
| 1.4 G1 | **Trim to 1.5 min.** |
| 1.5 Engineering | **Linger (+5 min).** Show the queue columns, filters, aging chips (the bucket edges are configuration, not an SLA), **Assign selected…**, **Reassign work…**, **Pin to top…** (needs a justification and is logged), and **Return to KAM…** with a reason. Show the solution fields, the **Equipment BOM** upload and its versions, and several **Capacity evidence** rows including **Utilization before %** and **Utilization after % (calculated)**. Show **Submit to engineering lead** and the lead's send-back. Show every G2 choice: **Advance**, **Advance with risk**, **Send back to…**, **Hold**, **Stop**. On a multi-item quote, show the item switcher on the tab. |
| 1.5a Scheduler | **Linger (+2 min).** Show **Block capacity** with a **Sign-off note** and the work returning to the engineer. |
| 1.5b Pricing | **Trim to 3 min.** Point at the **Engineering summary** pricers see, so your work isn't re-asked. |
| 1.9 | Show the **Engineering** lens in **Analytics** (who has what, waiting time, capacity blocks) instead of the leadership report. |

**Close**

SAY: "For engineering, the goal is fewer incomplete requests, a queue you control, and your capacity evidence captured once and used downstream. Two things I need from you. Are the solution and capacity fields right for each process, for example assembly has no cavitation? And do the choices at the feasibility gate match your real decisions? Please tell me what's wrong."

### 2.3 Pricing

**Opening (about 90 seconds)**

SAY: "I'll show you what lands on the pricing desk, what you record, and what QuoteFlow deliberately does not do. It does not price. Costing stays in Excel and the pricing application. QuoteFlow keeps the costing and payback workbooks with their versions, records who approved the price, the capital position and the terms checked, so Final Review has one clean package and nobody chases you for it."

**Emphasis**

| Section | Do |
|---|---|
| 1.3 to 1.4 | **Trim to 4 min total.** |
| 1.5 Engineering | **Trim to 2 min.** Show only what pricing inherits: the solution, the budgetary capital estimate, the equipment BOM and capacity evidence. |
| 1.5b, 1.5c Pricing | **Linger (+5 min).** Show the **Pricing queue** counts (**Awaiting price approval**, **Capital pending**, **Capital needed / with risk**). Show **Pricing history** and its read-only page. Show the three steps and a second version of the costing model. Show the capital rules: when Engineering's capital estimate is above $0, status can't be **Capital not required** and the payback model is needed. Show the **Pending-capital justification**. Show **Send back, hold or stop**: **Send back to…** offers **Pricing (re-cost)**, **Engineering**, **The KAM** and **Pricing (another capital model)**. Show **Earlier versions**. |
| 1.6 | **Linger.** Swap to `kam` and back to show that others can read the record and only Pricing can change it. |
| 1.7 | **Trim to 2 min.** Say that pricing never decides Final Review: "Approvals" isn't in your menu. |

**Close**

SAY: "For pricing: everything you need on one screen, history alongside, and a gate that won't let an incomplete package through. Two questions for you. Does the price approval record capture what Final Review really needs? And is the pricing history from the old export enough, or is something missing?"

### 2.4 Sales and Marketing leadership

**Opening (about 90 seconds)**

SAY: "I'll keep this at the level of what it gives you. Two things. A governed path for commercial capital opportunities, so every quote has an owner, a stage and a decision on record. And a view of the pipeline you can trust: where quotes wait, how long things take, why we win and lose. I'll walk one quote through quickly so you can see where those numbers come from."

**Emphasis**

| Section | Do |
|---|---|
| 1.2 | Add: "No write-back to Salesforce or the pricing app in this release. QuoteFlow reads from them." |
| 1.3 Intake | **Trim to 2 min.** |
| 1.4 G1 | **Linger (+2 min).** Show **To qualify**, the four choices, a hold with an owner and review date, and the **Overrides** tab (approve, reject, revert, and "you cannot decide your own override request"). |
| 1.5, 1.5b | **Trim to 2 min each.** Show queue and gate only. |
| 1.6 | **Keep.** It answers the data-access question before anyone asks. |
| 1.8 | Keep the hand-off, and add the lost-reason codes. |
| 1.9 | **Linger (+4 min).** Show the leadership Command Center, then **Analytics**: its filters, **Pipeline**, **Outcomes**, **Cycle time**, **Flow**, **Reasons**, **Quality and governance**, **Priority**, **Adoption**, the **Drill down** link, and the **Pipeline** page's **Board** view. Show the override log and the audit log. Say plainly: "These are operational metrics, not yet certified by D&A." |

**Close**

SAY: "For you: one place to see the commercial capital pipeline, a clear set of decisions with owners, and reasons for wins and losses captured consistently. What I need from you is your support for the KAMs to record outcomes, because the numbers are only as good as that. And tell me which view you'd look at every week."

---

## 3. Timing

| Section | Core | KAMs | Engineering | Pricing | Sales/Mktg leaders |
|---|---|---|---|---|---|
| 1.1 Opening | 2 | 1.5 | 1.5 | 1.5 | 1.5 |
| 1.2 What it is | 2 | 2 | 2 | 2 | 3 |
| 1.3 Intake | 5 | 8 | 2 | 2 | 2 |
| 1.4 G1 | 3 | 4 | 1.5 | 2 | 5 |
| 1.5 Engineering | 6 | 1 | 11 | 2 | 2 |
| 1.5b Pricing | 6 | 1 | 3 | 11 | 2 |
| 1.6 Who sees what | 2 | 2 | 2 | 3 | 2 |
| 1.7 Final Review | 3 | 1 | 1 | 2 | 2 |
| 1.8 Outcome and hand-off | 4 | 6 | 2 | 2 | 4 |
| 1.9 Leadership and audit | 4 | 1 | 4 | 2 | 8 |
| 1.10 Close | 2 | 2 | 2 | 2 | 2 |
| **Total (minutes)** | **39** | **28.5** | **32** | **30.5** | **33.5** |

Rule of thumb: the core is about 40 minutes with no questions. If you want audience Q&A inside a 45-minute slot, use a module's column (28 to 34 minutes), which leaves 10 to 15 minutes for questions. For a 30-minute slot, drop 1.7 to one sentence and show the KAM beat (1.6) only once.

The table does not include the segments added on 2026-11-17 (1.3b items, 1.5a Production Scheduler, 1.5c Finance, 1.7b offer letter). Each is about a minute and none has been timed in a rehearsal. The equipment BOM, costing model and payback uploads also add steps to 1.5 and 1.5b. Time the core again at the dry run, or show the new segments from a prepared quote.

---

## 4. Q&A prep

Suggested answers. Check anything marked **(check)** before you say it.

### Everyone

| Question | Answer |
|---|---|
| Does it replace Salesforce? | No. Salesforce stays the front door. Every quote links to an opportunity, and QuoteFlow reads from it. It does not write back. |
| Does it replace the pricing app? | No. Costing stays in Excel and the pricing application. QuoteFlow keeps the costing workbook and records that costing was completed and who approved the price. There is no field to type a price. |
| Is this real data? | No, today is synthetic data. |
| Who can see what? | Every role that can open a quote sees the same figures on it, pricing and capital included. What differs is which quotes you can open (all, a region, or your own) and what you may edit or decide. The server enforces both. |
| How do I sign in? | With your Microsoft account. Your role comes from your `SG-CCQ-*` security group. |
| Where is the data stored? | In Pretium's Azure tenant. The design mirrors it to Pretium's Fabric tenant for analytics. **(check whether the production mirror is running yet)** |
| Why are the stage names the way they are? | They're configuration, seeded with the proposed model and marked provisional until the owners approve them. If a name is wrong, tell me, it is a setting, not code. |
| What about the old ERF numbers? | There is an optional **Legacy ERF #** field during the transition only. |
| Is there AI in it? | Not making decisions. Any future assist is advisory, with a human decision recorded. |

### KAMs

| Question | Answer |
|---|---|
| Can I create a new customer here? | No. You tick **Not yet a Pretium customer (no ERP account)**. Account creation stays in Salesforce. |
| Can I see the price approval? | Yes, on your own quotes: "Price approved" with the date and who approved it, and the record behind it. You can't change it. |
| What if I forget something? | Required items carry a red asterisk, block submit and are listed with a **Fix** link. Optional gaps show as "Engineering may ask about this". Drafts are saved. |
| Can I change priority? | You can request an override with a justification. A leader approves or rejects it. |
| Can I work on my phone? | Intake and proposals are laid out for phones, including **Add photo** for a picture of a sample. |
| What if two of us have the same opportunity? | The picker shows **Has quote CCQ-…** with **Open existing**. Today's setting (provisional) also offers **Start a separate quote**, which asks you to confirm first. An Admin can switch it to one active quote per opportunity. |
| Can one quote hold several products? | Yes. Add an item for each product or variant on step 3. |
| Who writes the customer's offer letter? | QuoteFlow generates it as a Word document after Final Review, from the quote and the costing workbook. The wording is a draft until Legal approves it. |

### Engineering

| Question | Answer |
|---|---|
| Can I read the capital figure I typed? | Yes. Every role that can open the quote reads it. Only the assigned engineer and the engineering lead can change the solution. |
| Does it assign work automatically? | No. The lead assigns by hand, and the queue is ordered by tier, then score, then age. |
| Are the aging buckets an SLA? | No. The bucket edges are configuration, not an SLA. |
| Can the lead jump the queue? | Yes, with **Pin to top…**, which needs a justification and is logged. |
| What if capacity is blocked? | The production scheduler or the lead records **Block capacity** with a note. The work goes straight back to the engineer, who is told why, and Advance is not offered until capacity is approved. |
| Who owns capacity? | The production scheduler assigned to the quote, or the engineering lead. This is provisional until the owners decide. |

### Pricing

| Question | Answer |
|---|---|
| Where do I enter the price? | You don't. Costing stays in Excel and the pricing app. You upload the costing model and record costing complete, the approver, the basis and the range. |
| Does the pricing app feed this live? | No. The retired pricing app's export is imported by an Admin. It is read-only. **(check the current B-15 status)** |
| Can Final Review see my notes? | Yes. The approver sees the pricing record, the models and capital on the review page. |
| What if capital is needed? | When Engineering's capital estimate is above $0, capital readiness can't be **Capital not required**, Finance uploads a payback model, and capital has to be confirmed before the price goes to the pricing lead. |
| Who approves the price? | The pricing lead. The pricer submits to the lead. |
| Can I send it back? | Yes: **Send back, hold or stop**, then **Send back to…** Pricing (re-cost), Engineering or the KAM. Earlier versions stay visible. |

### Sales and Marketing leadership

| Question | Answer |
|---|---|
| Can I see every rep's quotes? | Leaders see their scope. Scope can be all, a region, or owner-only. |
| Can I change a decision? | Overrides are possible but need a justification and are logged. Nobody can approve their own override request. |
| How accurate are the dashboards? | They're operational metrics, not yet certified by D&A, and the screen says so. |
| What is the win rate based on? | Decided quotes only, shown next to the outcome capture rate. |
| Does the amount mean price? | No. It's the Salesforce opportunity amount, a size of opportunity. |
| What's the timeline? | **(check)** The dates in the build guide (UAT Nov 9 to Nov 13, MVP targeted for Nov 13) have passed. Confirm the current go-live date before you say one. |

---

## 5. Rehearsal checklist

- [ ] Ran the whole core once end to end on a fresh seed.
- [ ] Every button name above matches the screen.
- [ ] Wrote the live quote's number on a sticky note.
- [ ] Know which pre-seeded quote to open for each fallback.
- [ ] Practised the persona switch until it takes under 5 seconds.
- [ ] Timed my audience module against its column in section 3.
- [ ] Have the three synthetic `.xlsx` files (equipment BOM, costing model, payback model) on the desktop.
