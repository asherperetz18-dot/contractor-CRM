# Features index

What exists, split by domain since the full inventory is too large for one file. Each linked file is a table: feature, status (`shipped` / `partial` / `planned`), a grounded description, and where it lives in the code.

- [Sales Pipeline & Leads](features/sales-pipeline-leads.md) — the pipeline board, dialer, CSV import, refunds, contacts.
- [Estimates, Contracts & Projects](features/estimates-contracts-projects.md) — estimate builder, e-signature, payment schedules, change orders, completion certificates, the project/production board.
- [Billing, Payments & Commissions](features/billing-payments-commissions.md) — bills to pay, collections, P&L, dispatcher and sales-rep commissions, Stripe.
- [Scheduling & Communications](features/scheduling-communications.md) — schedule/calendar, SMS, voice, CallRail, inbound email, call/text reporting.
- [Marketing & Analytics](features/marketing-analytics.md) — lead-source attribution, rep performance, Facebook Lead Ads, social links.
- [Admin, Settings & Platform](features/admin-settings-platform.md) — auth/onboarding, the customer portal shell, platform admin, and the company Settings grid.

## Adding an entry

Add a row to the domain file that fits, or add a new domain file (and link it here) only if none of the existing six fit. Base descriptions on what the code actually does — read it, don't guess from a folder name. See the "Definition of done" checklist in `CLAUDE.md`.
