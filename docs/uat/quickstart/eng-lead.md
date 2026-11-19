# QuoteFlow quick-start: Engineering lead

> Checked against the build on 2026-11-17 (pre-release audit): the Command Center block reads **Time to assign and to decide**, the row menu item reads **Assign engineer**, and the list of decisions that need a note no longer names "capital required".

**What QuoteFlow is for you.** One queue for all upfront engineering work on new business quotes. You assign it and decide whether there is a feasible solution (gate G2, **Feasible solution?**). The stage is called **Engineering & Capacity**: an engineer works the solution and a production scheduler works the capacity.

**Your Command Center: Engineering queue.** It shows **Queue health**, **Open load per engineer**, **Time to assign and to decide** and **Returned to the KAM: top reasons**. You are alerted (bell and email) when a quote arrives. At the top are two views: **My work** and **Analytics**. Your menu: **Command Center**, **Engineering queue**, **Pipeline**, **Approvals**.

## What you'll do

1. **Assign work.** **Engineering queue** → row menu **…** → **Assign engineer** (or tick rows and **Assign selected…**). In the same dialog, **Production scheduler (optional)** adds the person who works the capacity part of that quote; both are notified. Use **Reassign work…** to move someone's open work.
2. **Return incomplete intakes.** Row menu → **Return to KAM…**. Say what is missing.
3. **Capacity.** The production scheduler on the quote approves capacity, or blocks it with a note. A block sends the work straight back to the engineer with that note; you and the KAM are told. On a quote with no scheduler, the **Approve capacity** and **Block capacity** buttons on the **Engineering** tab are yours. G2 Advance needs capacity approved.
4. **Decide G2.** **Engineering** tab → **Decide feasibility**: **Advance**, **Advance with risk**, **Send back to…** (the KAM, or Engineering to try another platform or site; give a reason and a note), **Hold** or **Stop**. Until the work is complete the button reads **Send back, hold or stop**. Capital is no longer a choice: the quote needs the **Budgetary capital estimate** (0 when no capital is needed), and the equipment BOM when the estimate is above $0. **Hold** is a pause, not a fix; its owner starts on the assigned engineer, who is told. If nobody has signed capacity off yet, tick **Capacity approved (I'm signing it off)** in the dialog: your approval is recorded with the decision, in one step. If capacity is blocked, the dialog shows why and the quote cannot advance.
5. **Keep order.** **Pin to top…** puts a quote first, with a reason. It is logged. You cannot change the priority tier: only a sales leader can.
6. **Review what your engineers submit.** The engineer and the production scheduler each submit their own part; **Ready for my review** lists a quote once every part is in, and you are told then (provisional). **With the engineering lead** on the tab shows which part is in. **Go to the decision** at the top jumps to your decision. If you are the engineer on a quote yourself, there is nothing to submit: decide it. Decide G2, or send it back with a note. With a production scheduler on the quote the button reads **Send back to…**: choose the engineer or the scheduler; only that person is notified.

## What changed from the ERF

- The queue is sorted by tier, score and age. You still assign by hand.
- You pick the engineer and the plant. The KAM no longer does.
- You and your engineers enter the **Tooling funding model** and **MOQ** on the quote (**Overview** → **Commercial terms**). Sales and Pricing no longer do.
- Capacity evidence and your sign-off are part of the G2 record. Utilization after the new business is calculated, not typed.
- Once you decide G2, the engineering section is locked until a send-back reopens it.
- A hold, an advance with risk, every send-back and a stop need a note.
- Returns go back to the KAM with a reason, and the quote keeps its number.

## Who to ask

- **Bailey Schmitt**, product owner: rules and definitions.
- **Tre Curry**, coordination: access and sessions.
- **Ben Whann**, builder: anything broken.
- Found a problem? Click **Report an issue** in your user menu or at the bottom of any page.
