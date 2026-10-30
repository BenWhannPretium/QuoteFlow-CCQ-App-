# QuoteFlow walkthrough: speaker script

One core script, four audience modules. Word-for-word. Demo runs locally in `AUTH_MODE=dev` on synthetic data, switching personas with the yellow **DEV** bar.

> **Status of this draft.** Written from the UAT scripts (`docs/uat/scripts/`), the landing definitions and the seed data. Labels and button names are copied from those. It has not been rehearsed against a running build. Do one full dry run and fix any button name that has drifted. Stage, gate and reason-code labels are provisional configuration, so a different wording on screen is fine.

**How to read this file**

- `SAY:` is spoken aloud, word for word.
- `DO:` is what you click. Don't read it out.
- `[PERSONA: x]` means pick `x` in the DEV bar's **Persona** dropdown.
- `[MODULE]` marks where an audience module plugs in.

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
2. Pick `kam`. **My quotes** loads, with blocks filled in (the seed holds 150 quotes spread across every stage).
3. **New intake** finds opportunities in the search box (the fake Salesforce is built from the same synthetic data).
4. Browser zoom 125%. Close Slack and email. Hide bookmarks.
5. Keep a second tab on `http://localhost:3000/docs` (the API docs) in case someone asks.

### Persona cheat sheet

| Beat | Persona key | What it shows |
|---|---|---|
| Intake | `kam` | **My quotes**, **New intake** |
| G1 qualify | `sales-leader` | **To qualify** |
| Engineering queue and G2 | `eng-lead` | **Engineering queue**, **Decide G2…** |
| Engineering review | `engineer` | **My assignments**, solution and capacity entry |
| Pricing triage | `pricing-lead` | **Pricing queue**, **Assign pricer…** |
| Pricing | `pricing` | **Quoting** tab, price approval record |
| Final Review | `approver` | **Approvals**, **Review & decide** |
| Overview, audit | `leadership` | **Analytics**, **Admin → Audit log** |

Other personas, if a question calls for them: `kam-owner` (sees only their own quotes), `kam-region` (West only), `engineer-owner`, `multi-role` (Sales leader and Approver, with role tabs), `admin`.

### If something goes wrong

- A persona switch doesn't change the page: reload the browser tab.
- The live quote stalls at a step: say "I'll jump to one we prepared earlier" and open any quote already in that stage from **Pipeline** (the seed has 22 in Engineering Review, 18 in Quoting and 10 in Final Review).
- A button is missing: you are probably on the wrong persona. Check the DEV bar.
- Never apologise at length. One sentence, then move on.

---

## 1. Core script (about 36 minutes)

### 1.1 Opening `[MODULE: opening, about 2 min. Swap in the audience hook from section 2.]`

### 1.2 What QuoteFlow is (2 min)

DO: Start on `kam`, **My quotes**. Point at the DEV bar.

SAY: "Before I start, one housekeeping point. The yellow bar at the top is a demo tool. It lets me sign in as different roles on my laptop. In the real app you sign in with your Microsoft account and your role comes from your security group. Everything you see today is synthetic data. There are no real customers in here."

SAY: "QuoteFlow replaces the old ERF application for new-business quotes that need engineering input or capital. Its job is simple. One governed place where a quote goes from intake, to engineering, to pricing, to final approval, to the customer's answer, and every step has an owner and a record."

SAY: "Three ideas to hold on to. First, Salesforce is the front door. Every quote starts from a Salesforce opportunity. Second, each role sees only what it needs. Third, everything is recorded. I'll show you all three."

### 1.3 Intake, as the KAM (5 min)

DO: **New intake**. Step 1, **Opportunity**. Type part of an opportunity name in **Find the Salesforce opportunity**. Leave **Mine** selected.

SAY: "A KAM starts by finding their own Salesforce opportunity. The details come straight from Salesforce: name, account, amount, close date, owner. I'm not retyping any of it."

DO: Click **Use this opportunity**. Step 2, **Customer & ship-to**.

SAY: "The customer is pulled from the Salesforce account and flagged as existing or not yet established. There is deliberately no way to create a customer account here. That stays in the system that owns it."

DO: Point at **Ship-to / fill location**. Click **Next**. Step 3, **Product & volume**. Fill the fields quickly (request class, product family, components, market, resin, neck finish, packaging type, annual volume, annual revenue, expected close date).

SAY: "Every field has a one-line reason for why we ask. And notice what the KAM is not asked: plant, engineer, priority. Those aren't the KAM's decisions."

DO: **Next**. Step 4, **Drawing, notes & review**. Set **Drawing** to **None (quote will take longer)**. Show **Engineering may ask about this**.

SAY: "If something is missing, I'm told up front what engineering may come back on. I can still submit. If it's a hard requirement, the Submit button stays disabled and tells me exactly what's missing."

DO: Type a short note in **Comments for engineering**. Click **Submit to CCQ**.

SAY: "And that's the intake. The system generates the quote number. That number follows this quote everywhere."

DO: Click **Open the quote**. Point at the quote number, stage **Intake**, priority tier, **Why this priority?**, the tabs and the **Timeline**. **Write the quote number on a sticky note. You'll look for it again later.**

SAY: "The priority is a score, and it's advisory. It orders the work. People decide."

### 1.4 G1: qualify and prioritise, as the Sales leader (3 min)

DO: `[PERSONA: sales-leader]`. Click **To qualify**.

SAY: "The first gate belongs to a sales leader. Submitted intakes, highest priority first. The score orders the list and the leader makes the call."

DO: Click **Decide** on your quote (or open it and click **Qualify & prioritize**). Hover an ⓘ. Show the outcomes: **Advance**, **Rework (back to KAM)**, **Hold**, **Redirect**, **Stop**.

SAY: "Each outcome has a definition. A rework goes back to the KAM with a reason and a note saying what to fix. A hold needs a review date and an owner. A stop needs a reason. This is what stops quotes sitting in limbo."

DO: Choose **Advance** and click **Record decision**.

SAY: "Advance. The quote leaves this list and lands in Engineering Review. One more rule I like: a sales leader cannot qualify an opportunity they own as KAM. The system enforces it."

### 1.5 Engineering (6 min)

DO: `[PERSONA: eng-lead]`. Click **Engineering queue**.

SAY: "Engineering sees every quote in Engineering Review, highest priority first. The columns tell the lead what they need to assign well: product, resin, volume, how long it has waited, whether there's a drawing."

DO: Open the row menu (**…**) on your quote, then **Assign…**. Pick an engineer. **Assign**.

SAY: "The lead assigns, with each engineer's open count visible. The engineer is notified."

DO: `[PERSONA: engineer]`. **My assignments**. Open your quote, **Engineering** tab, **Accept (start review)**.

SAY: "The engineer accepts and does the review. Process type, machine, plant, cavitation, cycle time, preliminary capital, tooling, technical concept."

DO: Fill a few fields. Click **Save solution**. Add one row under **Capacity evidence**. **Save capacity evidence**.

DO: Point at **Preliminary capital (USD)** and the capacity numbers now showing **Hidden**.

SAY: "This is worth a pause. I just typed a capital figure and capacity numbers, and now they say Hidden to me. This role can enter them, but it can't read them back. Capital and capacity numbers are commercially sensitive, and they are only returned to the roles that need them. That is not a hidden screen. The server doesn't send the figures to this role at all."

DO: `[PERSONA: eng-lead]`. Open the quote, **Engineering** tab. Click **Approve capacity**. Then **Decide G2…**, choose **Advance**, **Record decision**.

SAY: "Capacity needs a sign-off from the capacity owner before the gate can move, and the dialog tells you what's missing if you try too early. G2 outcomes include Advance, Advance with risk, Advance with capital required, Hold, Redirect and Stop. Note that the lead can see the figures. Different role, different view."

### 1.5b Pricing (6 min)

DO: `[PERSONA: pricing-lead]`. **Pricing queue**.

SAY: "The quote is now in Quoting. The pricing lead sees the whole queue, with counts for awaiting approval and capital pending, and assigns it to a pricer."

DO: Row menu, **Assign pricer…**, pick an analyst, **Assign**.

DO: `[PERSONA: pricing]`. Open the quote. **Quoting** tab.

SAY: "The pricer sees the engineering summary right next to the pricing record: process, plant, capital, capacity evidence. No chasing emails."

DO: Show the **Pricing history** card.

SAY: "Pricing history comes from the retired pricing app's export, loaded by an admin. It is read-only. QuoteFlow shows it, it never edits it."

DO: In **Price approval record**: tick **Costing completed (Cost-to-Serve)**, pick **Approved by**, set **Approved at**, add **Pricing basis** and **Approved negotiation range**. **Save price approval**.

SAY: "Here's a deliberate design choice. There is no field to type a price. Costing happens in Excel and the pricing application, which stay the systems of record. QuoteFlow records that costing was completed and who approved it."

DO: Set **Capital readiness** status. **Save capital readiness**. In **Commercial terms** tick **Terms checked** and **Save terms**.

DO: Click **Advance to Final Review…**, **Record decision**.

SAY: "To go forward, costing must be attested, capital readiness recorded, terms checked. Try to skip one and the dialog lists what's missing. That's the point of a gate."

### 1.6 The visibility beat (2 min)

DO: `[PERSONA: kam]`. Open the same quote, **Quoting** tab.

SAY: "Now watch what the KAM sees on the same quote. Only 'Price approved' with a date and a name. No pricing basis, no range, no capital, no figure."

DO: **Pipeline**, **Columns**. Show that **Prelim capital (USD)** and **Capital readiness** are not offered.

SAY: "It isn't just the screen. The columns aren't offered, the CSV export doesn't include them, and the emails the system sends contain no price, margin or capital amount. Sensitive fields come back only to Pricing, the engineering leads, approvers, leadership and admins."

DO: Type `/approvals` after the address.

SAY: "And if a KAM guesses the address of a page they shouldn't have, they get 'You don't have access to this'. The server decides, not the menu."

### 1.7 Final Review (3 min)

DO: `[PERSONA: approver]`. **Approvals**. Click **Review & decide** on your quote.

SAY: "Final Review is the approver's gate. Everything they need on one page: the request, the priority, the engineering solution and capacity evidence, the price approval, capital readiness, the files and every earlier decision."

DO: Click **Advance (release the offer)**. Show the dialog text (internal approval, **Proposal issued**, **Valid until**). **Record decision**.

SAY: "Approving here is internal. It releases the proposal to the customer. It does not award the quote. The proposal gets a valid-until date, and you'll see that matter in a minute. And two guard rails: an approver can't decide a quote where they're the KAM, or where they approved the price."

### 1.8 Customer decision and hand-off (4 min)

DO: `[PERSONA: kam]`. **My proposals**. Click **Record outcome** on your quote. **Awarded**, acceptance evidence **Purchase order (PO)**, accepted date today. **Record decision**.

SAY: "The customer answers, and the KAM records it. Awarded, lost, or no response. Lost needs a reason code, and an expired proposal needs a note. That feeds the reasons chart you'll see in a moment."

DO: Open the quote. Show the stage **Commit & Hand Off**. Click **Commit & hand off**, **Advance (close Won)**. Show **Missing before it can move on:**.

SAY: "Awarded does not mean closed. The deal is closed won only after the capital approval is recorded, or marked not required, and the receiving team accepts the hand-off. So we don't lose deals in the gap between a yes and actual production."

DO: Fill the card (**CER status**, **Receiving role**, tick **Hand-off accepted by the receiving team**), **Save hand-off**, then **Advance (close Won)**, **Record decision**.

### 1.9 Leadership view and the audit trail (4 min)

DO: `[PERSONA: leadership]`. **Home**.

SAY: "Leadership gets the whole picture. Open quotes, median time from intake to final approval, how complete intakes are first time, and win rate shown next to outcome capture rate. We show them together because a win rate means little if outcomes aren't being recorded."

DO: **Analytics**. Open an ⓘ.

SAY: "Every chart has a definition and a time window. Holds are excluded from cycle time, and the footer is honest that these are operational metrics, not yet certified by Data and Analytics."

DO: **Admin**, **Audit log**. Filter **Quote** by the number on your sticky note.

SAY: "And here is our quote. Every view, stage change, gate decision, override and export is written to an append-only audit log, with who, what and when. Nothing can be edited or deleted. Anyone who looked at this quote is on this list, including me just now."

DO: **Admin → Override log**.

SAY: "Overrides, like a changed priority or ship-to, need a reason and are logged with the original value. Leadership and admins can read it, nobody can quietly change history."

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
| 1.3 Intake | **Linger (+3 min).** Show the draft behaviour (leave **Resin** empty, point at **Needed before you can submit**), a ship-to change with its reason, and **Have drawing** vs **None**. Show **Continue a draft**. |
| 1.4 G1 | Add the rework loop: have the sales leader return it, switch back to `kam`, show **Returned to me**, the banner and **Fix and resubmit** with the same quote number. |
| 1.5, 1.5b | **Trim to 1 min each.** "Engineering and Pricing do their work here, and you can see the stage and who has it on your quote." |
| 1.6 | **Keep and explain gently:** "You will not see price or capital. That is by design and applies to every KAM." |
| 1.8 | **Linger.** This is their gate. Show **My proposals**, the validity dates, **Record outcome** and the reason codes. |
| 1.9 | **Trim to 1 min.** Show only **My outcome capture rate** on their home. |

**Close**

SAY: "So for you: one intake, no retyping Salesforce, a clear view of every quote, and a place to record the customer's answer. The one thing I need from you is the outcome. When a customer says yes, no or nothing, record it. That is what lets us learn why we win and lose. What did I miss in how you actually quote?"

### 2.2 Engineering

**Opening (about 90 seconds)**

SAY: "I'll show you how work reaches engineering, how you'd review it, and what happens after you hand it back. The headline: you get a prioritised queue with the drawing, product, resin and volume in front of you, one place to record the solution and the capacity evidence, and a clear decision at the end that says what happens next. I want your honest view on whether the fields match how you really assess a job."

**Emphasis**

| Section | Do |
|---|---|
| 1.3 Intake | **Trim to 2 min.** "This is what the KAM fills in. Notice it asks for resin, neck finish and packaging, and flags a missing drawing." |
| 1.4 G1 | **Trim to 1.5 min.** |
| 1.5 Engineering | **Linger (+5 min).** Show the queue columns, filters, aging buckets ("buckets, not an SLA"), **Assign selected…**, **Reassign work…**, **Pin to top…** (needs a justification and is logged), and **Return to KAM…** with a reason. Show the solution fields and several **Capacity evidence** rows including **Utilization %** and **Buffer %**. Show every G2 outcome, including **Advance – capital required** and **Hold**. |
| 1.5 Hidden beat | **Explain the why:** "Engineers can enter capital and capacity numbers but not read them back. Engineering leads can." |
| 1.5b Pricing | **Trim to 3 min.** Point at the **Engineering summary** pricers see, so your work isn't re-asked. |
| 1.9 | Show **Analytics → Engineering** view (who has what, waiting time, capacity blocks) instead of the leadership report. |

**Close**

SAY: "For engineering, the goal is fewer incomplete requests, a queue you control, and your capacity evidence captured once and used downstream. Two things I need from you. Are the solution and capacity fields right for each process, for example assembly has no cavitation? And does the G2 outcome list match your real decisions? Please tell me what's wrong."

### 2.3 Pricing

**Opening (about 90 seconds)**

SAY: "I'll show you what lands on the pricing desk, what you record, and what QuoteFlow deliberately does not do. It does not price. Costing stays in Excel and the pricing application. QuoteFlow records that costing was completed, who approved the price, the capital position and the terms checked, so Final Review has one clean package and nobody chases you for it."

**Emphasis**

| Section | Do |
|---|---|
| 1.3 to 1.4 | **Trim to 4 min total.** |
| 1.5 Engineering | **Trim to 2 min.** Show only what pricing inherits: the solution, preliminary capital and capacity evidence. |
| 1.5b Pricing | **Linger (+5 min).** Show the **Pricing queue** counts (**Awaiting price approval**, **Capital pending**, **Capital required / with risk (G2)**). Show **Pricing history** and its read-only page. Show the capital rules: if G2 said capital is required, status can't be **Not required**. Show **Capital likely** and the **Pending-capital justification**. Show **Hold or stop…**, **Rework (re-cost)**, **Return to Engineering…** and **Earlier versions**. |
| 1.6 | **Linger.** Swap to `kam` and back to prove what others can't see. |
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
| 1.4 G1 | **Linger (+2 min).** Show **To qualify**, the five outcomes, a hold with an owner and date, and the **Overrides** tab (approve, reject, revert, and "you cannot decide your own override request"). |
| 1.5, 1.5b | **Trim to 2 min each.** Show queue and gate only. |
| 1.6 | **Keep.** It answers the data-sensitivity question before anyone asks. |
| 1.8 | Keep the hand-off, and add the lost-reason codes. |
| 1.9 | **Linger (+4 min).** Show the leadership home, **Analytics** filters (region, market, KAM), **Pipeline**, **Outcomes**, **Cycle time**, **Reasons**, **Adoption**, the **Drill down** link and the **Pipeline → Board**. Show the override log and the audit log. Say plainly: "These are operational metrics, not yet certified by D&A." |

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
| 1.6 Visibility | 2 | 2 | 2 | 3 | 2 |
| 1.7 Final Review | 3 | 1 | 1 | 2 | 2 |
| 1.8 Outcome and hand-off | 4 | 6 | 2 | 2 | 4 |
| 1.9 Leadership and audit | 4 | 1 | 4 | 2 | 8 |
| 1.10 Close | 2 | 2 | 2 | 2 | 2 |
| **Total (minutes)** | **39** | **28.5** | **32** | **30.5** | **33.5** |

Rule of thumb: the core is about 40 minutes with no questions. If you want audience Q&A inside a 45-minute slot, use a module's column (28 to 34 minutes), which leaves 10 to 15 minutes for questions. For a 30-minute slot, drop 1.7 to one sentence and show the Hidden/KAM beat only once.

---

## 4. Q&A prep

Suggested answers. Check anything marked **(check)** before you say it.

### Everyone

| Question | Answer |
|---|---|
| Does it replace Salesforce? | No. Salesforce stays the front door. Every quote links to an opportunity, and QuoteFlow reads from it. It does not write back. |
| Does it replace the pricing app? | No. Costing stays in Excel and the pricing application. QuoteFlow records that costing was completed and who approved the price. There is no price field. |
| Is this real data? | No, today is synthetic data. Production data waits for IT and Data and Analytics approval. |
| Who can see what? | By role, enforced on the server. Pricing, margin and capital figures go only to Pricing, the engineering leads, approvers, leadership and admins. |
| How do I sign in? | With your Microsoft account. Your role comes from your `SG-CCQ-*` security group. |
| Where is the data stored? | In Pretium's Azure tenant, mirrored to Pretium's Fabric tenant for analytics. |
| Why are the stage names the way they are? | They're configuration, seeded with the proposed model and marked provisional until the owners approve them. If a name is wrong, tell me, it is a setting, not code. |
| What about the old ERF numbers? | There is an optional **Legacy ERF #** field during the transition only. |
| Is there AI in it? | Not making decisions. Any future assist is advisory, with a human decision recorded. |

### KAMs

| Question | Answer |
|---|---|
| Can I create a new customer here? | No. Customers are flagged existing or not yet established. Account creation stays in Salesforce. |
| Why can't I see the price? | By design for every KAM. You see "Price approved" with a date and who approved it. |
| What if I forget something? | Required items block submit and tell you what's missing. Optional gaps show as "Engineering may ask about this". Drafts are saved. |
| Can I change priority? | You can request an override with a justification. A leader approves or rejects it. |
| Can I work on my phone? | Intake and proposals are laid out for phones, including taking a photo of a sample. |
| What if two of us have the same opportunity? | One active quote per opportunity. The second person sees **Open existing**. |

### Engineering

| Question | Answer |
|---|---|
| Why can't I read the capital figure I just typed? | Engineer role is enter-only for capital and capacity. Engineering leads can read them. |
| Does it assign work automatically? | No. The lead assigns by hand, and the queue is ordered by tier, then score, then age. |
| Are the aging buckets an SLA? | No. The screen says "Buckets, not an SLA". |
| Can the lead jump the queue? | Yes, with **Pin to top…**, which needs a justification and is logged. |
| What if capacity is blocked? | The lead records **Block capacity** with a note. The gate can't advance until it's approved. |

### Pricing

| Question | Answer |
|---|---|
| Where do I enter the price? | You don't. Costing stays in Excel and the pricing app. You record costing complete, the approver, the basis and the range. |
| Does the pricing app feed this live? | No. The retired pricing app's export is imported by an Admin. It is read-only. **(check the current B-15 status)** |
| Can Final Review see my notes? | Yes. Approvers are a commercial role and see the pricing record and capital. |
| What if capital is required? | If Engineering said capital is required at G2, capital readiness can't be **Not required**. A pending status needs a justification. |
| Can I send it back? | Yes: **Rework (re-cost)**, or **Return to Engineering…**. Earlier versions stay visible. |

### Sales and Marketing leadership

| Question | Answer |
|---|---|
| Can I see every rep's quotes? | Leaders see their scope. Scope can be all, a region, or owner-only. |
| Can I change a decision? | Overrides are possible but need a justification and are logged. Nobody can approve their own override request. |
| How accurate are the dashboards? | They're operational metrics, not yet certified by D&A, and the screen says so. |
| What is the win rate based on? | Decided quotes only, shown next to the outcome capture rate. |
| Does the amount mean price? | No. It's the Salesforce opportunity amount, a size of opportunity. |
| What's the timeline? | **(check)** UAT is Nov 9 to Nov 13, with MVP targeted for Nov 13. |

---

## 5. Rehearsal checklist

- [ ] Ran the whole core once end to end on a fresh seed.
- [ ] Every button name above matches the screen.
- [ ] Wrote the live quote's number on a sticky note.
- [ ] Know which pre-seeded quote to open for each fallback.
- [ ] Practised the persona switch until it takes under 5 seconds.
- [ ] Timed my audience module against its column in section 3.
