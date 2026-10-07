---
name: ui-ux-pro-max
description: Design system and UI/UX rules for this project's web app and Chrome extension — tokens, type scale, spacing, shared controls, component patterns, states, accessibility, copy, and a review checklist with a browser check. Use whenever adding or changing any screen, component, CSS module, modal, form, empty state or extension page, or when asked to make the UI look better, more professional, consistent or accessible.
---

# UI/UX for Job Tracker

Look: clean SaaS (Linear / Notion family). Light, neutral slate greys, **one** indigo accent,
Inter, thin borders over heavy shadows, a 4px spacing grid, quiet motion. Information first:
a job seeker scans dozens of cards; nothing decorative competes with the job title.

## Where things live

| File | Owns |
|---|---|
| `frontend/src/styles/tokens.css` | Every raw value: colours, type, space, radius, shadow, motion, z-index, layout. Imported once by `src/index.css`. |
| `frontend/src/styles/controls.module.css` | Shared primitives: `btn` + `primary/secondary/ghost/danger/dangerGhost/link`, sizes `sm/lg/block/icon/iconSm`, `field/label/hint/input`, `alertError/alertInfo/alertSuccess`, `badge`, `spinner`, `surface`, `backdrop/dialog`. |
| `frontend/src/index.css` | Reset, body defaults, the global `:focus-visible` ring, reduced-motion. |
| `Component.module.css` | Layout and anything specific to that component — composed from the above. |

The extension's pages (`board.html`, `sidepanel.html`) import `@app/index.css`, so they get
the same tokens. Content scripts (`trackerButton.js`) render inside LinkedIn/XING/StepStone
with inline styles in a shadow root; they can't use the tokens — keep their values in sync by
hand when the brand colour changes.

## Hard rules

1. **No literal values in component CSS.** Colours, font sizes, radii, shadows, durations
   come from `var(--…)`. Spacing uses `--space-*` (a one-off `1px`/`2px` border or nudge is
   fine). Need a new value? Add a token to `tokens.css` first, with a comment if non-obvious.
2. **Reuse controls via `composes`, don't restyle them.**
   ```css
   .saveBtn { composes: btn primary from '../styles/controls.module.css'; }
   .nameInput { composes: input from '../styles/controls.module.css'; }
   ```
   Then add only layout (`margin-top`, `flex: 1`) on top. A component that needs a button
   variant the controls don't have → add it to `controls.module.css`.
3. **One primary action per view** (one `primary` button). Everything else is
   `secondary`, `ghost` or `link`. Destructive actions are `danger` only at the final
   confirmation step; before that, `dangerGhost`.
4. **Text colour ladder:** `--text` (titles, values) → `--text-secondary` (body) →
   `--text-muted` (meta, captions). `--text-faint` is for icons/placeholders only — it fails
   contrast as text.
5. **White text sits on `--accent` (brand-600), never brand-500** (4.5:1 borderline).
6. **Type scale only:** `--text-2xs` badges · `xs` meta · `sm` labels/secondary · `base` body,
   inputs, buttons · `lg` modal titles · `xl` page titles · `2xl/3xl` pricing hero. Weights:
   400 body, 500 controls/labels, 600 titles and emphasis, 700 rarely (prices, brand).
7. **Radius by size:** `xs` badges/tiny chips · `sm` icon buttons · `md` buttons, inputs,
   cards · `lg` panels, columns, menus · `xl` modals, auth card · `full` pills.
8. **Elevation by layer:** flat + border for things on the page; `--shadow-xs` controls and
   cards; `--shadow-md` hover lift; `--shadow-lg` menus/popovers; `--shadow-overlay` modals.
9. **Status colours** live only in `KanbanBoard.jsx` `COLUMNS` (the PDF export needs plain
   values) and reach CSS as the `--col-color` custom property. Tints are
   `color-mix(in srgb, var(--col-color) 8%, transparent)`. Use them as a dot, a 3px accent
   bar or a tinted badge — never as large fills or as text on white.

## Patterns

- **Buttons:** sentence case ("Add job", not "Add Job"); verb first; icon left, 16px
  (14 in `sm`/`iconSm`). Height 36 (`sm` 30). Loading: keep the label, add a `spinner`, disable.
- **Icons:** `lucide-react` only — `import { Pencil } from 'lucide-react'`, `<Pencil size={14} />`.
  No hand-drawn `<svg>` and no text glyphs (←, ↗, ✕, ✓) as icons. Sizes: 16 buttons/menus/header,
  14 small buttons, column headers and chevrons, 12 inline meta (date, "View posting ↗" →
  `ArrowUpRight` *after* the text). Keep Lucide's default stroke (2); thicker (2.5–3) only for a
  tiny check or close glyph. Colour is `currentColor`: inherit, or `--text-faint`/`--text-muted`
  for decorative ones. Same meaning → same icon everywhere (interview = `MessagesSquare`,
  external = `ArrowUpRight`, delete = `Trash2`, close = `X`). Column status icons live in
  `COLUMNS[].icon`. Lucide icons are `aria-hidden` by default; icon-only buttons need `aria-label`.
- **Logo:** `components/Logo.jsx` (indigo tile + white briefcase). Its plain-colour copy is
  `public/favicon.svg`, from which the extension PNGs (`extension/public/icons/{16,48,128}.png`)
  are rendered, and `trackerButton.js` draws the same glyph on its badge — change all together.
- **Forms:** label above input, `gap: var(--space-1-5)`; fields `gap: var(--space-4)`. Optional
  fields say "(optional)" in `--text-muted`; don't mark required ones with red asterisks.
  Errors: one `alertError` above the submit button, worded as what to do next.
- **Modals:** `backdrop` + `dialog`; header (title `--text-lg` 600, optional subtitle muted,
  close `ghost iconSm`), body padding `--space-6`, footer right-aligned: secondary then
  primary. Escape and backdrop click close it; focus the first field.
- **Menus/popovers:** `surface` + `--shadow-lg`, `--radius-lg`, items 32px high, hover
  `--bg-hover`.
- **Empty states:** say what's missing and what to do ("No jobs yet — save one from a job
  board or add it here"), with the action as a button where possible. Never a blank panel.
- **Loading:** a spinner only after ~300 ms of waiting is acceptable; keep layout stable.
- **Cards (JobCard):** title (`base`, 600) → company (`sm`, muted) → meta row (`xs`, muted).
  Row actions appear on hover/focus-within, and stay visible on touch (`@media (hover: none)`).
- **Copy:** plain, short, sentence case. "Log in" (verb) / "Login" (noun) — buttons use the
  verb. German users read English UI fine, but avoid idioms.

## Accessibility (non-negotiable)

- Contrast ≥ 4.5:1 for text, ≥ 3:1 for icons/borders that carry meaning.
- Every interactive element is a `<button>` or `<a>`; icon-only ones get `aria-label`.
- Keyboard: everything reachable, visible `:focus-visible` (global ring in `index.css`;
  inputs use `--focus-ring`). Don't remove outlines without a replacement.
- Hit targets ≥ 24×24 (prefer 32+); the side panel is narrow, so check it.
- Motion: `--duration*` + `--ease`; nothing over 300 ms; reduced-motion is handled globally.
- Errors use `role="alert"`, notices `role="status"`.

## Review checklist (run before calling UI work done)

1. `grep -nE '#[0-9a-fA-F]{3,6}\b|rgba?\(' frontend/src/components/*.css frontend/extension/src/*.css`
   — new hits need a reason (status tints in `KanbanBoard.jsx`, content scripts are exempt).
2. `scripts/check.sh frontend` builds.
3. Look at it (the `run-app` skill), at 1440px and ~400px wide (side panel width), for:
   alignment on the 4px grid, one primary action, hover/focus/disabled/loading/empty/error
   states, long text (a 60-char German job title, a long company name) truncating or
   wrapping cleanly.
4. Tab through the screen once with the keyboard.
