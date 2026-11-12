# 08: Production Azure: what IT provisions

**For:** Vincent Brown (IT). **From:** Ben. **Written:** 2026-11-12. **Time:** about 30 minutes, all in the Azure portal.

Test already runs in Azure. Ben deploys production himself from the repository's Bicep (`infra/`) using the
Azure CLI, so IT provides only the foundation below. Production uses the **same network design as test**:
public endpoints protected by Entra sign-in, TLS and credentials (decision 2026-11-12, `infra/README.md`
"Prod network posture").

**Not needed from IT:** a virtual network, private endpoints, private DNS, a VPN or jump box, a firewall
exception for Ben, or a Fabric VNet data gateway.

Open a step's walkthrough only if you want the clicks spelled out.

## 1. Register the resource providers

On the subscription that will hold production, register: `Microsoft.Web`, `Microsoft.DBforPostgreSQL`,
`Microsoft.KeyVault`, `Microsoft.Storage`, `Microsoft.Insights`, `Microsoft.OperationalInsights`,
`Microsoft.ManagedIdentity` (and `Microsoft.Authorization`, `Microsoft.Resources` if not already).

<details>
<summary>Step-by-step</summary>

1. Portal, **Subscriptions**, open the subscription that will hold production.
2. **Settings, then Resource providers**.
3. For each name: type it in the filter, select the row, choose **Register**, and wait for **Registered**.

</details>

## 2. Create the resource group `rg-ccq-prod`

Region **Central US**. Add the tag `costCenter` (the right cost center for QuoteFlow) and tell Ben the value.
Also add `app = quoteflow`, `owner = embedded-intelligence`, `env = prod`.

<details>
<summary>Step-by-step</summary>

1. Portal, **Resource groups**, **Create**.
2. Subscription: the one from step 1. Name: `rg-ccq-prod`. Region: **(US) Central US**.
3. **Next: Tags**, add the four tags above.
4. **Review + create**, **Create**.

The deployment tags every resource with `app`, `owner` and `env` itself. Ben adds `costCenter` to the
parameter file once he has the value.

</details>

## 3. Make Ben an Owner of `rg-ccq-prod`

Owner on this resource group only, not the subscription. The deployment creates role assignments (web app to
Key Vault and storage, the GitHub deploy identity), which needs Owner. Contributor plus User Access
Administrator on the same group also works.

<details>
<summary>Step-by-step</summary>

1. Open **rg-ccq-prod**, **Access control (IAM)**.
2. **Add, Add role assignment**.
3. **Privileged administrator roles** tab (older layouts: **Job function roles**), select **Owner**, **Next**.
4. Members: **User, group, or service principal**, **Select members**, pick Ben, **Select**.
5. **Review + assign**, twice.

</details>

## 4. Check for Azure Policy that could block the deployment

Look at the policies assigned to the subscription or its management group. Tell Ben about any that restrict
allowed regions, names, required tags, or public network access on PostgreSQL, Key Vault, Storage or App
Service, or add an exemption for `rg-ccq-prod`. "No blocking policies" is a fine answer.

<details>
<summary>Step-by-step</summary>

1. Portal, **Policy**, then **Authoring, Assignments**, scope = the subscription.
2. Scan for: allowed locations, tags, naming, public network access, private endpoints, SKU restrictions.
3. For any that apply, tell Ben the rule, or select it and **Create exemption** scoped to `rg-ccq-prod`.

</details>

## 5. Confirm capacity in Central US

Production needs a Linux App Service plan at **Premium v3 P1v3** (2 vCPU) and a PostgreSQL Flexible Server at
**General Purpose Standard_D2ds_v5** (2 vCPU).

<details>
<summary>Step-by-step</summary>

1. Portal, **Subscriptions**, the subscription, **Settings, Usage + quotas**.
2. Region filter **Central US**. Search `Premium v3` and `Ddsv5`; each needs room for at least 2 vCPUs.
   (Labels vary by portal version.)
3. If the limit is 0 or too low, select the row and **Request increase**.

</details>

## 6. Give Ben an alert mailbox

An on-call address or distribution list for production health alerts (website down, database down, errors).
Nothing to configure in the portal.

## 7. Confirm the production sign-in groups in Entra

Production honors roles starting with `CCQ.` from the existing QuoteFlow-API app registration. Confirm each
role exists and is assigned to its group. Ben adds the production redirect URL himself (he owns the app
registrations).

<details>
<summary>Step-by-step</summary>

1. Entra admin center, **Enterprise applications**, **QuoteFlow-API**, **Users and groups**.
2. Check each group below is listed with its role.
3. A missing role is under **App registrations, QuoteFlow-API, App roles** (Ben can add it as owner). Groups
   may need a groups administrator.

| Group | Role value |
|---|---|
| `SG-CCQ-KAM` | `CCQ.KAM` |
| `SG-CCQ-SalesLeader` | `CCQ.SalesLeader` |
| `SG-CCQ-EngLead` | `CCQ.EngLead` |
| `SG-CCQ-Engineer` | `CCQ.Engineer` |
| `SG-CCQ-Pricing` | `CCQ.Pricing` |
| `SG-CCQ-PricingLead` | `CCQ.PricingLead` |
| `SG-CCQ-Finance` | `CCQ.Finance` |
| `SG-CCQ-Approver` | `CCQ.Approver` |
| `SG-CCQ-Leadership` | `CCQ.Leadership` |
| `SG-CCQ-Admin` | `CCQ.Admin` |

Who goes in each group is decided at UAT. Only members of an assigned group can sign in.

</details>

## What Ben needs back

The cost center, the alert mailbox address, "no blocking policies" (or what they are), "quota OK" (or the
increase request), and a note that steps 1 to 3 and 7 are done.

## After that

Ben deploys the rest from `infra/` with the CLI: web app and staging slot, PostgreSQL, Key Vault, storage,
monitoring, alerts and the GitHub deploy identity, plus the database restart and the Key Vault secrets.

Later, not needed now: a shared mailbox and Graph permission for email (off until then), SharePoint site
access (blob storage until then), a custom domain if wanted, and D&A for the Fabric mirror (they need the
database server name once it exists).
