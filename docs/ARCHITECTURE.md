# Architecture

System map for the contractor CRM. For what exists feature-by-feature, see `docs/FEATURES.md`. For why a non-obvious call was made, see `docs/DECISIONS.md`.

## Stack

- **Frontend/backend**: Next.js (App Router), TypeScript, Tailwind. Server Components fetch data directly via Supabase server client; mutations go through Server Actions (`src/lib/actions/*`), not API routes, except where an external system needs a public HTTP endpoint (webhooks, cron).
- **Database/auth**: Supabase (Postgres + Auth). Schema lives in `supabase/schema.sql`; every change since is a numbered migration in `supabase/migrations/` (140+ as of this writing) — read the migration, not just the schema file, when you need to know *when* or *why* a column exists.
- **Hosting**: Vercel, deployed from `main`.
- **Third-party integrations**: Stripe (payments), Twilio (SMS/voice, incl. Voice Intelligence transcription), CallRail (call tracking), Meta/Facebook Lead Ads, Google Drive (document backup), Anthropic Claude (AI call notes, lead-conversation analysis, AI scope-to-estimate line items).
- **Scheduled jobs**: Supabase Cron (`pg_cron` + `pg_net`, migration 0203) calls the `/api/cron/*` routes on a schedule with a token the database makes and keeps in its vault; the routes check it with the database (`refuseCronCaller`, `src/lib/cron-auth.ts`). `CRON_SECRET` (`src/lib/cron-env.ts`) still works, for the GitHub Actions "Run workflow" buttons and the nightly backup, which stays on GitHub (DECISIONS #140). See the Cron section below for the full list.

## Multi-tenancy & roles

Every tenant-scoped table carries `company_id`; there is no query pattern anywhere that should skip it. Two coarse roles exist at the product level — `Office` (full access) and `Field` (read-everything, write only jobs + schedule) — but the actual permission surface in code is much finer-grained: `src/lib/data/types.ts` exports dozens of specific checks (`canEditDispatch`, `canManageBills`, `canManageCosts`, `canViewFinancials`, `canViewProfitLoss`, `canDeleteLeads`, `canEditVendors`, `isStrictAdmin`, `isDispatchScoped`, `isPlatformAdmin`, etc.), each backing a specific UI gate. **The UI check is a convenience, not the boundary** — Supabase Row Level Security policies are the actual enforcement layer, and every migration that adds a table or changes access has a corresponding RLS policy. Do not add a new tenant-data table or route without RLS coverage.

`isPlatformAdmin` is a separate axis entirely from company role — it answers "does this identity operate the platform," not "is this person an admin of the company they're currently in," and has its own gate (`PlatformAdminGate`) outside the per-company Settings grid.

## Data flow patterns worth knowing

- **`selectAll` wrapper** (`src/lib/data/select-all.ts`): a bare Supabase `select` silently stops at 1000 rows. Any query that could plausibly exceed that (events, leads, etc.) is wrapped in `selectAll`, which pages through with `.range()`. Missing this wrapper on a growing table is a real, previously-hit bug class — check for it when adding a new list-everything query.
- **Dispatcher/dispatch-scoping**: some roles see only the leads "behind" their own appointments, which RLS otherwise hides from them entirely. `getAppointmentHolders()` / `getLeadsBehindAppointments()` (`src/lib/actions/dispatcher.ts`) backfill just enough of that hidden data server-side so the appointment window still works for a scoped viewer, without widening what they can see generally.
- **Money is always integer cents** (`*_cents` columns/fields), formatted at the edge with `moneyCents`/`money` helpers in `src/lib/data/types.ts`. Never do float arithmetic on money.
- **Encrypted per-company secrets**: Stripe/Twilio/CallRail credentials a contractor brings themselves are stored encrypted at rest (`src/lib/crypto/secrets.ts`) and are write-only in the UI — a saved key is never round-tripped back to the browser, only its last 4 characters.
- **Portal auth is separate from staff auth**: customers authenticate via single-use magic links plus a street-number passcode challenge (`src/lib/portal/session.ts`), with office-revocable access independent of the link itself. Do not assume `getCurrentProfile()`-style staff auth applies inside `src/app/portal/*`.

## Cron jobs (Supabase Cron → `/api/cron/*`)

Started by the database on the minute (UTC), not by GitHub, whose timers ran late or not at all when it was busy (DECISIONS #140). The times live in `supabase/migrations/0203_scheduled_jobs.sql` (and the migration that added a later job, e.g. 0208); `cron-token.test.ts` holds each job to exactly one scheduler. Each GitHub workflow keeps its "Run workflow" button for a run by hand. To see the schedule or recent runs, in the Supabase SQL editor: `select jobname, schedule, active from cron.job;` and `select status_code, created from net._http_response order by created desc limit 20;`.

| Job | Schedule | Purpose |
|---|---|---|
| `rain-alerts` | 3x/day | Warns on ≥50% rain probability within 48h of a scheduled appointment/project. |
| `no-show-followups` | — | Auto-moves a lead out of "Appointment Scheduled" at 8pm local time if nobody logged an appointment result. |
| `task-reminders` | — | Texts the assigned rep ~2h before a lead task is due. |
| `appointment-reminders` | — | Texts leads 2–20h ahead of their appointment. |
| `callrail-backfill` | — | Syncs/backfills CallRail call data into leads. |
| `backup` (nightly, GitHub Actions) | nightly | Full data export, same logic the manual Backup settings page uses. Locked with the `BACKUP_PASSPHRASE` secret (gpg, AES-256) before it is stored as an Actions artifact; the job refuses to run without the secret (DECISIONS #098). |
| `google-calendar-sync` | every 15 min | Pull then push for every connected Google Calendar (per-rep and company-wide). |
| `quickbooks-sync` | every 5 min (scheduled by 0222) | Sends new and changed bills and bill payments to the QuickBooks of each company that turned sending on; voids and deletes there what the CRM voided or deleted (DECISIONS #173). |
| `bill-reminders` | hourly (scheduled by 0208) | Automatic payment reminders for companies that switched them on: 3 days before a bill is due, on the day, then weekly up to 3 times; 9am-6pm company time (DECISIONS #152). |

Jobs that work company by company go through `runForEachCompany` (`src/lib/cron/run-companies.ts`, DECISIONS #126): each company in its own try/catch, a turning order, and a four-minute budget, so one company's failure or a slow outside service never stops the rest. A new per-company job should use it too; `src/lib/cron/each-company.test.ts` lists the jobs that must.

## Where to look for X

- Permission checks: `src/lib/data/types.ts`
- Server mutations: `src/lib/actions/*`
- Cross-cutting server-only helpers: `src/lib/*.ts` (env/secret access, integrations)
- DB schema + history: `supabase/schema.sql`, `supabase/migrations/`
- Feature inventory by domain: `docs/features/*.md`
