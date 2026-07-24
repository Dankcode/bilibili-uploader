# Studio Suite — Design System

A minimal, technical, CRM-style system for the automated video pipeline. The
goal is a dense, consistent, navigable operator console — not a marketing site.
One accent color, muted borders, monospace for anything the machine owns
(IDs, paths, metrics, timings), and generous but regular spacing.

All values live as CSS custom properties in `src/app/globals.css`. Nothing in
the app should hardcode a hex value — read a token. Components share
`src/app/page.module.css`, which is built entirely on these tokens, so a change
to a token restyles the whole product.

## 1. Foundations

### Color

The palette is a layered dark neutral scale plus a single blue accent and four
status hues. Layering (`--bg` → `--surface` → `--surface-2` → `--surface-3`)
creates depth without shadows or gradients.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0d10` | App background |
| `--surface` | `#121519` | Cards, sidebar, tables |
| `--surface-2` | `#171b21` | Inputs, table header, hover |
| `--surface-3` | `#1d222a` | Active segmented control, tracks |
| `--border` | `#232830` | Default hairline |
| `--border-strong` | `#2f3742` | Inputs, emphasis dividers |
| `--text` | `#e7eaee` | Primary text |
| `--text-muted` | `#98a2b1` | Secondary text |
| `--text-faint` | `#626d7c` | Labels, placeholders, metadata |
| `--accent` | `#4f8cff` | Primary actions, active nav, focus |
| `--ok` `--warn` `--danger` `--running` | green / amber / red / blue | Status only |

Rule: color is meaning. The accent marks the one primary action or the active
location. Status hues appear only on status (job state, connection health,
diagnostics) — never as decoration. Each status hue has a matching `*-soft`
translucent fill for chips and badges.

### Typography

- **Sans** (`--font-sans`, Inter): all UI copy and labels.
- **Mono** (`--font-mono`): identifiers, file paths, timestamps, metrics,
  space/channel IDs, job step names. If the machine produced it, it's mono.

Type scale: `--fs-xs` 11px · `--fs-sm` 13px · `--fs-md` 14px (base) · `--fs-lg`
16px · `--fs-xl` 20px. The UI is intentionally small and dense; headings are
weight, not size (600–650), so tables and controls dominate the page.

### Spacing, radius, motion

- Spacing is a 4px scale: `--sp-1`…`--sp-6` (4/8/12/16/24/32). Use tokens, not
  arbitrary rems, so rhythm stays regular.
- Radius: all three radius tokens are 2px. Corners are square/near-square across
  controls, panels, cards, and modals; circles remain reserved for status dots.
- Motion is fast and subtle: `--dur` 140ms on `--ease`. Hover/active only;
  no entrance animations on data.
- Focus is always visible: `--ring` (3px accent-soft halo) on `:focus-visible`.

## 2. Layout

A fixed **sidebar** (`--sidebar-w` 232px) + fluid **main** column.

- **Sidebar**: brand block, primary navigation (the six views), and a mono
  footer showing LAN address and global status. Nav is the app's spine —
  destinations, not actions.
- **Top bar** (`--topbar-h` 56px, sticky, blurred): the current view title, a
  context badge (active source), the **workspace context selectors** (Channel →
  Source, a clear hierarchy), and the primary workflow actions (Sync & Scrape,
  Continuous Loop). Context + actions live here so they're constant across views.
- **Content**: one padded column of cards/tables.

Below 860px the sidebar collapses to a horizontal strip and selectors wrap —
preserving the LAN-from-mobile use case.

## 3. Components

- **Buttons** — `buttonPrimary` (accent fill, one per context), `buttonSecondary`
  (outline), plus compact table actions (`editBtn`, `uploadNowBtn`, `saveBtn`).
  All share sizing, radius, and transition; disabled = 45% opacity.
- **Nav item** — icon + label; active state is accent-soft fill + accent border.
- **Segmented control** (`viewTabs`) — inset group for sub-switches.
- **Chips** — pill filters (`filterChip`/`activeFilterChip`) and context tabs.
- **Status label** — pill with a leading dot; color encodes state. Canonical
  classes: `notstarted/queued/canceled`, `inprogress/running`, `done/ok`,
  `warn`, `failed`.
- **Table** — sticky mono-label header, hairline rows, row hover, horizontal
  scroll wrapper. The primary data surface.
- **Card / panel** — `tableCard` (header + body) and `panelBody` (padded).
- **Job row + step grid** — per-step cards with `progressTrack`/`progressFill`
  bars for the pipeline.
- **Connection row** — the Settings CRM unit: configured → tested → enabled,
  with a mono meta line.
- **Diagnostic check** — dot (`check_ok/warn/fail`) + message + fix hint.
- **Modal** — centered, blurred overlay; used for add-channel/add-source.

## 4. Principles

1. **Tokens only.** No literal colors/spacing in component CSS.
2. **Color is meaning.** Accent = primary/active; status hues = status.
3. **Mono for machine data.** IDs, paths, times, metrics.
4. **Density with rhythm.** Small type, tight rows, but spacing stays on the
   4px scale.
5. **Every interactive element has hover + focus-visible.**
6. **One primary action per view**, always reachable in the top bar.
7. **Near-square surfaces.** Use the radius tokens; pills are reserved for compact
   statuses where their shape carries meaning.

## 5. Extending

Add a token before adding a value. New status → add `--x` and `--x-soft` and a
label class. New destination → add a `NAV_ITEMS` entry + an icon in `ICONS`
(inline SVG, `currentColor`). New surface → continue the `--surface-n` ladder;
don't invent a one-off gray.
