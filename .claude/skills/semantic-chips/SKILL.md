---
name: semantic-chips
description: Chip/badge/pill color logic — standing rule (always, automatic). Use whenever adding, editing, or styling any chip, badge, pill, tag, or quick-link row anywhere in the CRM UI. Color says meaning, never decoration — money in is green, money out is red, one color per idea — and chips cluster by meaning in a flex row, never a dot-separated text line.
---

# Chips are read by color before they're read by label

The owner's rule (2026-09-17, Projects row chips): a row of same-colored
chips is a wall of words. Every chip's color must state its meaning, and
chips sit in clusters so the eye can jump to "the money" or "the
paperwork" without reading.

## The color map

| Meaning | Color | Class | Examples |
|---|---|---|---|
| Money coming **in** | **green** | `proj-chip-in` | Contract, Change orders |
| Money going **out** | **red** | `proj-chip-out` | + Bill, Bills |
| Progress / the plan | blue (base) | `proj-check-chip` | Checklist (`-done` green fill, `-overdue` bold red alarm) |
| Paperwork pile | indigo | `proj-chip-paper` | Permits & contracts |
| Media | purple | `proj-photo-chip` | Photos |
| A person | rose | `proj-client-chip` | Client |
| Print / report | slate | `proj-chip-report` | Report |

Green and red are **reserved for money direction** (the checklist's
done/overdue states are the one grandfathered exception — done is a
green fill on the blue chip, overdue is an alarm, not money). A new
non-money chip picks a new idea-color; a new money-touching chip picks
its direction first.

## The mechanics

- Single source of truth: `src/lib/job-chips.ts` (`jobChipClass`,
  `jobChipGroup`), pinned by `src/lib/job-chips.test.ts`. **Never
  hardcode a chip's classes in a component** — extend the map and its
  test, then read it. The office table (`projects-view.tsx`) and crew
  cards (`crew-view.tsx`) both read it; keep any new surface on it too.
- CSS lives in `globals.css` next to `.proj-check-chip`: one shared
  pill (works on `<button>`, `<a>` and `<Link>` alike — the base carries
  `display:inline-block` and `text-decoration:none`), pastel background
  + darker text per color, `:hover` brightness dip.
- Layout: chips go in `.proj-chip-row` (flex, wraps), clustered into
  `.proj-chip-group` spans in scan order **progress → money in → money
  out → records**. The wider row gap (14px vs 4px) is the cluster
  boundary — no dividers, no " · " separators. `.proj-chip-group:empty`
  hides itself, so permission-gated chips can vanish without leaving a
  stray gap; keep conditionals *inside* the group span.
- Mentions of chip colors in user-facing copy (tutorials!) must match
  the map — grep the tutorial captions when a color changes.
