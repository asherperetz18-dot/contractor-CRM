---
name: responsive-check
description: Phone/tablet rendering check — standing rule (always, automatic). Use whenever adding or touching ANY page, panel, card row, table, chart, or CSS anywhere in the CRM UI. Before shipping, prove the surface works at iPhone (390), Android (412), iPad portrait (768) and iPad landscape (1024) widths — screenshot at least phone + tablet — and never gate content behind a display:none that has no small-screen equivalent.
---

# Every screen works on the phone in the truck

The owner's rule (2026-09-22, dashboard on iPhone/iPad): the CRM is
used from job sites on phones and tablets at least as much as from the
office desktop. A surface that only works at laptop width is not done.
Dashboard 2.0 shipped hidden under 900px — phones got a widget list
instead of the dashboard — and nobody caught it until the owner opened
it on his iPhone.

## The check (before every push that touches UI)

Render the touched surface at these widths and look at it:

| Width | Stands in for |
|---|---|
| 390px | iPhone |
| 412px | most Androids |
| 768px | iPad / tablet portrait |
| 1024px | iPad / tablet landscape (sidebar open leaves ~740px of page) |
| 1440px | desktop |

The app can't run in the cloud workspace (no Supabase login), so use a
**static harness**: a small HTML file that links the real compiled CSS
from `.next/static/css/*.css` (run `npm run build` first) and carries
the surface's real markup structure with representative values, then
`chromium --headless --screenshot --window-size=<w>,<h>` at each width
(Chromium is preinstalled at `/opt/pw-browsers/chromium`). Attach at
least the phone and one tablet screenshot to the PR as proof. On a
machine with the app running, real-page screenshots beat the harness.

**Headless-Chromium trap (cost a debugging round):** it clamps windows
to ~500px wide, so `--window-size=390` silently lays out at 500 and
"phone overflow" appears that isn't real (or real overflow hides). For
phone widths, constrain the harness itself —
`html.phone, html.phone body { width: 390px }` — which is faithful
because every media rule in this app treats 390 and 500 the same (both
≤700). Then measure against 390, not `clientWidth`. If Playwright is
installed, its viewport emulation avoids all of this.

Instrument, don't eyeball: append a script that lists every element
whose `getBoundingClientRect()` runs past the target width into a
`<pre>` at the top of the page, so the screenshot itself names the
overflowing selectors.

## What to look for (each has bitten)

- **Content gated away**: a `display: none` under a breakpoint with no
  equivalent shown instead. The 900px block once hid the entire
  dashboard from phones. Hiding chrome is fine; hiding content is not.
- **Fixed column counts**: `repeat(4, 1fr)` / `repeat(5, 1fr)` grids
  need collapse rules (the repo's pattern: 3-across ≤1100, 2-across
  ≤700 — see `.stat-grid-5`). `auto-fit, minmax()` grids usually
  self-handle but check the minmax floor × 2 + gap still fits 390px.
- **Overflow with no scroller**: any `min-width` element (charts) and
  any `.data-table` needs a horizontal scroll container. Bare
  `.data-table`s become their own scroller ≤700 automatically
  (globals.css "Tables that aren't inside a .table-scroll wrapper");
  everything else wraps in `.table-scroll` / its own `overflow-x: auto`.
- **Headline type at half width**: a 26px money figure in a 2-across
  tile collides — step values down ≤700 (`.dash-kpi-grid .stat-value`).
- **Flex toolbars that don't wrap**: filter rows, panel heads, legends
  get `flex-wrap: wrap`; a `margin-left: auto` control gets
  `flex: 1 1 100%` on phones when it crowds the title.
- **Long unbroken strings** (URLs, emails) need `overflow-wrap:
  anywhere` or they push the layout wide.
- **Touch has no hover and no HTML5 drag**: anything hover-revealed or
  drag-only needs a tap path or must degrade to nothing lost (the
  dashboard's box order still applies on touch; it just can't be
  rearranged there — acceptable, documented).
- **Tap targets**: row buttons and chips stay ≥ ~40px tall on phone
  widths.

## The app's breakpoint map (don't invent new ones)

- **900px** — the app-wide split: sidebar becomes an off-canvas drawer
  behind ☰, topbar compacts, `.dash-mobile` (the Modules tile
  launcher) appears under the dashboard. Page content must remain
  visible on both sides of this line.
- **1100px** — wide grids step down (5→3 tiles), two-column panel
  grids go single.
- **700px** — the phone rules: 2-across tiles, self-scrolling tables,
  stacked layouts, smaller headline type.

Prefer adding rules at those three widths over minting new query
values, so the whole app steps down together.
