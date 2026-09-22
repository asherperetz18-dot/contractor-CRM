---
name: release-notes
description: Version bump + on-screen update notice — standing rule (always, automatic). Use on EVERY change to the CRM, whatever else the task is: before the commit that finishes the work, bump package.json's version and add that version's plain-language entry to src/lib/release-notes.ts, so the CRM announces the update on screen (the update popup on stale tabs, the What's new screen on fresh loads). npm test and CI both fail without it.
---

# Every update bumps the version and announces itself on screen

The owner's rule (2026-09-22): "always update version and give
notification screen on CRM of any update." Before this rule the version
was bumped once in 54 PRs (1.131.0 at #194, then nothing), so the
update popup never fired and people ran week-old bundles without
knowing a thing had changed. The CRM already had the plumbing; what it
lacked was the habit. The habit is now enforced.

## What you do, every PR, without being asked

1. **Bump the version** with `npm version minor --no-git-tag-version`
   (or `patch`) — it updates `package.json` and both `version` lines of
   `package-lock.json` together, so the lockfile never drifts. Something
   a user can see or do differently → minor (`1.132.0` → `1.133.0`). A
   fix or invisible change (perf, refactor, code comments) → patch
   (`1.132.0` → `1.132.1`). Never a major bump without the owner.
2. **Add the entry to `src/lib/release-notes.ts`**, at the top of
   `RELEASE_NOTES`, same version string, today's date, one line per
   change. Write what a person on the team sees differently, in plain
   words — not what the code does. "Search finds a client by the start
   of their address" — not "added trigram index on leads.search_text".
   A fix says what stopped going wrong.
3. **Re-check just before opening the PR** (like migration numbers):
   `git fetch origin main` and confirm your version is *above* main's.
   Parallel sessions ship here — if main moved past you, bump again
   and move your entry to the top. A PR that lands with main's version
   deploys silently, which is the exact failure this rule exists for.
4. Nothing else. Do not touch the popup or the What's new screen for an
   ordinary change; they read `RELEASE_NOTES` and `package.json`.

## What enforces it

- `src/lib/release-notes.test.ts` — fails `npm test` when the newest
  entry's version is not `package.json`'s (bump without note, or note
  without bump), when the list is out of order or has a duplicate, or
  when a note is too short to mean anything.
- The **Version bumped** step in `.github/workflows/ci.yml` — fails
  the `lint-test-build` check on any PR whose `package.json` version
  equals the base branch's. So a PR that forgot goes red before it can
  be merged.

## How it shows up (so you can describe it in the PR)

- Tabs already open when the deploy lands: the existing update popup
  (`src/app/(app)/update-notice.tsx`, polls `/api/version` every 5 min
  and on tab focus) now lists the new version's notes under "What's
  new" before asking for a refresh. "Later" only postpones.
- Everyone else — a fresh open, or the refresh from that popup — gets
  the **What's new in vX** screen (`src/app/(app)/whats-new-notice.tsx`)
  once per version per browser; "Got it" remembers the version in
  localStorage (`crm.whats-new.seen`).
- The sidebar's `vX.Y.Z` is `package.json`'s version, so it now changes
  with every update.

## The PR

Mention the new version number in the PR body's "What changed" (the
owner reads the sidebar to confirm a deploy took), and put the release
note's wording there — the two should say the same thing.
