@AGENTS.md

# Engineering standards

Stack: Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres + Auth), deployed on Vercel. Full map in `docs/ARCHITECTURE.md`.

## TDD — how everything gets built here

1. **Red** — write a failing test first (`node:test` + `node:assert/strict`, in a `*.test.ts` beside the code — see `src/lib/receipts.test.ts`). It must fail for the right reason before any implementation exists.
2. **Green** — write the minimum code to pass it.
3. **Refactor** — clean up with the suite green.

Fixing a bug: reproduce it as a failing test first, then fix — that test is what stops it coming back. Changing untested legacy code: add a test for the behavior you're about to touch before you touch it. No production logic lands without a test that would fail without it.

## Branch & PR policy

`main` is protected — no direct pushes, by anyone, ever. Every change lands via a PR from a feature branch, and the `lint-test-build` CI check must be green before merging. Enforced server-side by GitHub branch protection on `main`, not just this document (see `docs/DECISIONS.md` #007).

## Definition of done

- [ ] Test written first, suite passes — `npm test`
- [ ] `npm run lint` clean
- [ ] New tenant-data table/route has RLS coverage — a UI check alone is never the boundary
- [ ] Docs updated: feature → `docs/features/<domain>.md` · non-obvious call → `docs/DECISIONS.md` · known shortcut → `docs/TECH_DEBT.md`
- [ ] Skip the docs step only for trivial changes (typos, formatting, dependency bumps) — use judgment, don't pad them

## Code quality

- No speculative abstraction — solve what's in front of you, not a hypothetical future case. Three similar lines beat a premature helper.
- Delete dead code; don't comment it out.
- One logical change per commit.
- Money is integer cents, always. Every tenant query scopes by `companies`. Roles (`Office` full-access / `Field` read-all-write-jobs-and-schedule) are enforced server-side via RLS, never only in the UI.

## Docs map

- `docs/ARCHITECTURE.md` — system map, data model, auth/roles
- `docs/FEATURES.md` → `docs/features/*.md` — what exists, by domain
- `docs/DECISIONS.md` — why
- `docs/TECH_DEBT.md` — known debt
