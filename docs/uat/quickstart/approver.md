# QuoteFlow quick-start: Final Review approver

> Checked against the build on 2026-11-17 (pre-release audit): the Command Center block reads **Waiting for Final Review**, and a hold needs a reason as well as a note and a review date. Updated 2026-11-17 for the approved UX changes (docs/audit/03-ux-proposals.md).

**What QuoteFlow is for you.** A one-page review of each quote Pricing submits, and a recorded decision to release the offer (gate G4, **Release proposition**). Approving is internal. It does not award the quote: only the customer's answer does.

**Your Command Center: Approvals.** It shows **Waiting for Final Review** and **Decided recently**; a quote on hold is listed first, with an orange **On hold** chip. At the top are two views: **My work** and **Analytics**. You get an email when a quote needs you. Your menu: **Command Center**, **Pipeline**, **Approvals**. It works on a phone.

## What you'll do

1. **Open the queue.** **Approvals** → **Final Review**. Each card shows price approval, capital readiness, the engineering decision, the KAM and the pricing approver.
2. **Review.** Click **Review & decide**: the request, the priority, the engineering solution and capacity evidence, the price approval, capital readiness, files and decisions so far.
3. **Decide.** Use the bar at the bottom: **Advance (release the offer)**, **Hold**, **Send back to Quoting or Engineering** or **Stop (withdraw)**. Stop needs a reason and a note. A send-back needs a reason, a note and where it goes (**Send to**). Hold needs a reason, a note and a review date. A quote that is already on hold is not offered **Hold** again: any other decision ends the hold.
4. **Check the validity.** Advance sets the proposal issue date (now by default) and the valid-until date.

## What changed from the ERF

- Final Review is separate from the customer outcome. Advance releases the offer; the KAM records Awarded or Lost later.
- An open terms check or Legal review shows as a warning with a link. It does not stop you. You edit and confirm the **Capital terms** on the review screen (**Confirm capital terms**). You cannot release the offer until you do, or while a non-standard payment-terms exception is waiting for the pricing lead or was rejected. When something blocks the release, the bottom of **Open warnings** says "The offer cannot be released yet. This blocks it:" and lists each item with a link to where it is fixed.
- After you release the offer, the terms and the capital flag are locked.
- You cannot decide a quote where you are the KAM, or whose price you approved.

## Who to ask

- **Bailey Schmitt**, product owner: rules and approver tiers.
- **Tre Curry**, coordination. **Ben Whann**, builder.
- Found a problem? Click **Report an issue** in your user menu or at the bottom of any page.
