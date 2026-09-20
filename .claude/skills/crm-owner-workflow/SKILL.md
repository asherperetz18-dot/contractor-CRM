---
name: crm-owner-workflow
description: How changes actually ship in this repo — the owner's PR and merge habits, the hand-run SQL migration discipline with code fallbacks, the 79k-contact scale rules, the poll-route rule, and the account/data quirks earlier sessions learned the hard way. Read before preparing any PR, migration, fix, or investigation here.
---

# Working with this repo's owner

Lessons from real sessions, kept so the next one doesn't relearn them.

## The owner and the cadence

- The owner (Asher, Pacific time) is not an engineer. PRs are read as
  plain language: what a user sees differently, why, where, proofs, and
  how to test it themselves. Any manual step goes in **bold**.
- **They merge within minutes of a PR opening — sometimes before you're
  done pushing.** Never open a PR until every commit it needs is already
  pushed; never plan to "add one more commit" to an open PR. PR #179
  was merged six minutes in, carrying one of its three intended commits,
  and the rest had to be rebased into a new PR.
- One feature branch serves the whole session, so PRs are sequential:
  ship a complete batch, wait for the merge, restart the branch from
  `origin/main`, repeat.

## Migrations (the thing that has actually broken production)

- The owner runs every `supabase/migrations/*.sql` by hand in the
  Supabase SQL editor — and has shipped code without running its
  migration twice (0154's missing table errored in the UI; 0155 left
  search half-fixed). Assume a migration might not run for days.
- Therefore: write every migration idempotent and safe as one paste,
  and **give the code a fallback when at all feasible** — call the RPC,
  and on error take the old, slower path (`rep_lead_stats`/0156 and
  `marketing_funnel_rollup`/0157 are the pattern: a pure, tested TS
  mirror of the SQL doubles as the fallback and pins the SQL's buckets).
- In the PR and in chat, name the exact file to paste and say it's safe
  to run twice. After a merge, remind once.
- **Migration numbers race.** Several Claude sessions ship in parallel
  here, and two of them once claimed 0159 in the same afternoon — the
  loser renamed to 0160 and had to chase the number through nine files
  (settings copy, engine comments, docs). Before writing a migration,
  fetch main and take the number AFTER its newest file; before opening
  the PR, fetch again and re-check it's still yours.

## Scale: ~79,000 contacts

- Never ship or scan the whole contact book. The cures, in order of
  preference: fetch only referenced ids (`.in("id", leadIds)`), search
  server-side (`searchBookableLeads` / `searchEstimateLeads` pattern),
  serve aggregates from SQL (0156/0157). See DECISIONS #019–#021 and
  the standing note in TECH_DEBT.
- Recurring client polls never ship as Server Actions — an action
  re-runs the whole layout (~1.5s) and queues against the user's own
  clicks. Thin route handlers instead (DECISIONS #029); the four
  poll routes under `src/app/api/` are the pattern.

## Account and data quirks

- The roster has two accounts for the same person: **"Asher"** (the
  super-admin account, deliberately holds no Sales role so it can't be
  picked as a salesperson) and **"Asher Peretz"** (the actual rep).
  Never suggest merging or renaming them; historical name lookups read
  the whole roster on purpose.
- A signed document's salesperson is frozen at signature
  (`effectiveEstimateRepId`) by design; commission seats stay editable
  (Admin-only, confirmed, audited — DECISIONS #026/#028). Don't
  "fix" the frozen column; it's the record of who sold the job.

## Product rules the owner keeps asking for

- **Summary cards follow the page's filters, always.** The estimates
  funnel, Payments' cards, and Projects' cards each recompute over the
  rep/client/search/date-filtered rows (whether a status chip also
  scopes them is each page's documented call). Wire any new stat card
  to the filtered list from day one: an unfiltered card above a
  filtered table gets quoted as the filtered number. Patterns:
  `funnelCardStats`, `paymentsSummary`, `projectTotals`.
- **Stat cards do something on click**: land on whatever itemizes the
  number — a chip/filter on the same page, or the page that breaks the
  figure down (#184). A card with the default pointer cursor that does
  nothing reads as broken.

## Small conventions that bit before

- `.stat-card` renders a pointer cursor and hover ring by default — a
  card that does nothing must carry `stat-static`, and a clickable one
  renders as `<button type="button" className="stat-card">` (reset in
  globals.css). An inert card that looks clickable reads as broken.
- Blocking confirms are `window.confirm` with plain, specific words —
  the repo's established idiom.
- Debounced server search in a client component copies the topbar
  idiom: 300ms timeout ref + request-id ref, stale answers discarded.
- The lint baseline is exactly one pre-existing warning
  (`activity-tracker.tsx`, `no-location-assign-relative-destination`).
  A second warning is yours.
