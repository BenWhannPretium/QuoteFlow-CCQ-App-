# B-05 · App shell, Pretium design system, role landing (F-02 shell, F-14 mobile)

**Paste into Claude Code from the repo root.**

---

Read `CLAUDE.md`. Build the web app shell and a themed component kit so every feature screen after this is quick and consistent.

## Design tokens (Pretium; from the CCQ Workflow Blueprint and the Pretium design system)
- **Colors:**
  - Pretium Green `#225651` (primary), Green-2 `#416F6B`
  - Copper `#C05131` (actions/emphasis), hover `#A64427`
  - Background `#F5F7F6`, surface `#FFFFFF`, surface-2 `#F5F7F6`, surface-3 `#DFE6E5`
  - Lines `#DFE6E5` / `#C7D5D3`
  - Text `#14211F`, secondary `#2F4A47`, muted `#416F6B`
- **Dark mode:**
  - bg `#0D1A18`, surface `#132623`, surface-2 `#18302C`, line `#22403B`
  - fg `#E7EFEE`, muted `#9CB3B1`, copper text `#EC8A66`
- **Priority tier chips:**
  - Critical: copper fill, white text
  - High: `#F6E5E0` bg with `#B04A2C` text
  - Standard: `#DFE6E5` with `#225651`
  - Low: `#EEEDEA` with `#4F4932`
- **Typography:** display "Value Serif Pro" → Georgia fallback; body "Basis Grotesque Pro" → Arial fallback. Load the brand fonts only if Pretium provides licensed font files (put them in `apps/web/public/fonts`; otherwise use the fallbacks).
- **Shape:** radius 16px for cards, 999px for pills. Shadow `0 1px 2px rgba(20,33,31,.06), 0 6px 18px rgba(34,86,81,.07)`.

Implement the tokens as CSS variables in `apps/web/src/styles/tokens.css`, mapped into the Tailwind theme and the shadcn/ui CSS variables. Support system dark mode plus a manual toggle; store the preference in localStorage inside a try/catch.

## Shell
1. **Layout:** a green brand header band with the QuoteFlow wordmark, a global search box (wired in B-14), the notification bell (B-18), the user menu (name, roles, sign out, theme toggle) and the dev persona switcher in dev mode.
2. **Navigation:** a left rail on desktop and a bottom tab bar on mobile (≤ 640px). Items are role-aware via `useCan`:
   - Home
   - New intake (KAM, SalesLeader)
   - My queue (EngLead/Engineer/Pricing/Approver, labelled per role)
   - Pipeline
   - Approvals (Approver)
   - Analytics (analytics.read)
   - Admin (config.manage)
3. **Routes (TanStack Router):**
   - `/`: role landing that picks the primary role's dashboard. Placeholder cards for now; B-17 fills them.
   - `/intake/new`
   - `/quotes`
   - `/quotes/$quoteNumber`
   - `/queue/engineering`
   - `/queue/pricing`
   - `/approvals`
   - `/board`
   - `/analytics`
   - `/admin/*`

   Create lazy route stubs with page titles.
4. **Shared components** (`src/components/`):
   - `PageHeader` (title, eyebrow, actions)
   - `StageBadge` (label from config)
   - `TierChip`
   - `ScorePill` (number + tooltip slot)
   - `KeyValueGrid`
   - `EmptyState`
   - `ErrorState` (problem+json aware)
   - `ConfirmDialog`
   - `GateDecisionDialog` (shell only)
   - `Timeline` (shell only)
   - `DataTable` (TanStack Table: sortable, sticky header, responsive card layout on mobile)
   - `FiltersPopover` (compact filter button pattern per PRD F-07)
   - `Toaster`
   - `Skeleton` loaders
5. **Error boundary + 404 + 403 pages.** Global query error handling shows toasts for 5xx and inline errors for 4xx.
6. **Config bootstrap:** `GET /api/v1/config/public` returns stage/gate/outcome labels, value lists, reason codes and settings needed by the UI. Use cached queries, so the UI never hard-codes labels. Add this API route now (permission `quote.read`) reading from the config tables.
7. **Accessibility:** visible focus ring (copper), skip link, aria landmarks, color contrast ≥ 4.5:1 for text (check the tier chips), respect `prefers-reduced-motion`.
8. **Mobile:** test at 390×844. No horizontal scroll, 44px tap targets, 16px side gutters.

## Tests
- Playwright:
  - sign in as each dev persona → correct nav items visible and the correct landing page
  - mobile viewport snapshot of the landing page
- An axe accessibility check on the landing page (`@axe-core/playwright`).

## Acceptance
- [ ] All personas land on the right page with the right nav
- [ ] Light/dark both legible; axe has no serious violations
- [ ] 390px layout has no horizontal scroll
- [ ] Tick B-05 in `docs/build-guide/03-build-steps.md`
