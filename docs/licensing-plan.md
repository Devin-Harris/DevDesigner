# Licensing & Payments Plan

Status: draft (2026-11-23). Nothing implemented yet.

## Principles

- Keep the core editor generous. Free users hit a ceiling (a quantity limit), never a broken or watermarked feature.
- Pro is sold on scale and collaboration: unlimited projects and tables, more collaborators, storage, version history, offline desktop and custom themes.
- Downgrades never delete data. Projects over a limit become read-only until the user upgrades or archives them.
- Limits are data (an entitlements table), not hard-coded `if plan === 'pro'` checks, so prices and limits can change without a release.

## Tiers

| | **Guest** (no account) | **Free** | **Pro** | **Team** (later) |
|---|---|---|---|---|
| Price | $0 | $0 | **$6/mo or $60/yr** | ~$10/user/mo (yearly discount) |
| Projects | 5 | 5 | Unlimited | Unlimited |
| Tables per project | 100 | 100 | Unlimited | Unlimited |
| Image storage | 100 MB | 500 MB | 10 GB | 25 GB pooled |
| Slides (no watermark) | ✓ | ✓ | ✓ | ✓ |
| PDF export for slides | ✓ | ✓ | ✓ | ✓ |
| Other exports (SQL, PNG, JSON) | ✓ | ✓ | ✓ | ✓ |
| MCP read tools | ✗ | Unlimited | Unlimited | Unlimited |
| MCP write tools | ✗ | 15,000/mo, given out as ~3,500/week | Unlimited | Unlimited |
| Live collaborators per project | 2 | 3 | 10 | Unlimited |
| Share links | View | View + edit | + password / expiry | + workspace roles |
| Version history | 7 days | 30 days | 1 year | Unlimited |
| Custom themes/designs | Built-in | Built-in + 1 custom | Unlimited | Shared team library |
| Desktop app offline mode | — | — | ✓ | ✓ |
| SSO/SAML, audit log | | | | Add-on |

### Self-host / Enterprise
- Flat yearly license (roughly $1–3k/yr, or "contact us"), with updates included.
- When the license expires, the app keeps working but stops getting updates.
- Price it properly when the first company asks.

### Discounts
- Discounts for students and open-source maintainers.
- 14-day Pro trial, no card required.

## MCP write quota

- Guests get no MCP access, because API tokens need an account to own them.
- Free: about 3,500 write calls a week (15,000 a month spread over weeks). Pro and Team: unlimited.
- **Weekly reset at a fixed time, Monday 00:00 UTC.** Store one counter per user per ISO week, keyed like `2026-W48`. A weekly reset means nobody burns the whole month in a few days and then waits weeks.
- Each tool call counts as one write, however many items it changes, so `apply_diagram_spec` isn't penalized.
- Every tool is tagged as read or write. Read tools are never counted.
- At about 80% usage, add a warning note to tool results so the agent can tell the user.
- At the limit, return an error with the reset time and an upgrade link. Read tools keep working.
- Show usage in API token settings, e.g. "2,812 / 3,500 writes this week · resets Mon".
- **Every plan** gets a per-minute rate limit per token (~60–120 writes/min) as an abuse guard, separate from the quota. Unlimited means no quota, not no rate limit.
- The Terms of Service include a fair-use clause covering unlimited plans.

## Payments

**Start with a merchant of record (Paddle or Lemon Squeezy).** They are the legal seller and handle VAT and sales tax worldwide. Consider moving to Stripe Billing + Stripe Tax once revenue makes doing your own tax filing worthwhile.

Approximate fees:

| | Merchant of record (~5% + 50¢) | Stripe (~2.9% + 30¢, plus ~0.5% for Tax) |
|---|---|---|
| $6 monthly | keep ~$5.20 | keep ~$5.50 |
| $60 yearly | keep ~$56.50 | keep ~$57.80 |

Push people toward yearly billing in the upgrade UI.

Flow:
1. The user clicks Upgrade. The server creates a checkout session tagged with their user or workspace ID.
2. Payment happens on the provider's hosted checkout. We never handle card data.
3. Webhooks (`subscription.created/updated/cancelled`, `payment_failed`) update the database. Handlers must be idempotent.
4. Billing, invoices, card changes and cancellation go through the provider's hosted customer portal.
5. A nightly job reconciles subscriptions with the provider, in case a webhook was missed.

## Implementation checklist

- [ ] `plans` / `entitlements` model. Limit keys: `maxProjects`, `maxTablesPerProject`, `storageBytes`, `mcpWritesPerWeek` (null = unlimited), `maxCollaborators`, `historyDays`, `customThemes`, `offlineDesktop`.
- [ ] `subscriptions` table linked to a user (later a workspace), holding the provider IDs and status.
- [ ] Server-side enforcement:
  - [ ] Project create, including import and the MCP `create_project` / `import_project_json` tools.
  - [ ] Table create, including the import endpoint and the MCP `add_table` / `apply_schema_changes` / `apply_diagram_spec` / `import_project_json` tools.
  - [ ] Image upload (sum bytes per owner).
  - [ ] Joining a realtime room (collaborator count).
  - [ ] MCP write quota and per-minute rate limit in the API-token middleware.
  - [ ] Version-history pruning per plan.
- [ ] Turning a guest into an account keeps their projects and raises the storage limit to 500 MB.
- [ ] Over-limit state: projects become read-only, with an upgrade or archive prompt. Never delete data.
- [ ] Client: usage meters ("5 / 5 projects", storage, MCP writes) and upgrade prompts. The client only displays limits; the server enforces them.
- [ ] Checkout, webhook and customer-portal endpoints, plus a pricing page.
- [ ] Desktop offline mode and self-host: signed license file (Ed25519, public key embedded) checked offline, with a ~14-day grace period. Could use Keygen.sh or Lemon Squeezy's license API.
- [ ] Legal pages: Terms of Service (with fair use), Privacy Policy, refund policy, and later a Data Processing Agreement for Team.

## Rollout

1. Free + Pro with a merchant of record, monthly and yearly billing, server-side limits.
2. Team: workspaces, seats, roles, pooled storage.
3. Self-host licensing and SSO when the first company asks.
4. Revisit prices after about 50 paying users. Existing customers keep their price.
