# QuoteFlow quick-start: Admin

**What QuoteFlow is for you.** You keep the business rules as data: value lists, reason codes, workflow labels, settings, scoring and user scope. Each change needs a reason and goes to the decision log. Seed values stay **Provisional** until their owner approves them.

**Your home screen: Administration.** Click **Open admin**. Your menu also has **New intake**, both queues, **Pipeline**, **Approvals** and **Analytics**.

## What you'll do

1. **Change configuration.** **Admin** → **Value lists**, **Reason codes**, **Workflow labels and rules**, **App settings** or **Scoring model**. Say why in "Why are you making this change?" and click **Save change**. Once the owner signs off, set **Approval** to **Mark approved by me**.
2. **Set user scope.** **Admin** → **Users and scope** → **Scope**. Roles come from the `SG-CCQ-*` groups in Entra; ask IT to change those.
3. **Watch the integrations.** **Admin** → **Integrations**: Salesforce sync runs, the Fabric mirror check and the pricing-history import.
4. **Triage UAT reports.** **Admin** → **Feedback**: set status, owner and a GitHub issue link.
5. **Read the audit.** **Admin** → **Audit log**, **Decision log**, **Usage report**, **ERF linkage**.

## What changed from the ERF

- Rules are configuration, not code. No developer is needed to change a label, a reason code or a threshold.
- Every change is versioned with who, what, why and when.
- No local accounts. Access comes only from Entra groups.

## Who to ask

- **Bailey Schmitt**, product owner and interim approver of config changes.
- **Tre Curry**, coordination. **Ben Whann**, builder.
- Found a problem? Click **Report an issue** in your user menu or at the bottom of any page.
