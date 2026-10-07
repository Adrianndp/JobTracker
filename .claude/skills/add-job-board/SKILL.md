---
name: add-job-board
description: Add a new job board (e.g. Indeed.de, Arbeitsagentur Jobbörse) to the Chrome extension's one-click "Save to Job Tracker" button, or fix an existing board (LinkedIn, XING, StepStone) whose button stopped appearing or reads the wrong title/company. Use for any change to the extension's content scripts, jobBoards.js or trackerButton.js.
---

# Add or fix a job board

Each supported board is: a URL parser in `frontend/extension/src/jobBoards.js`, a content
script `frontend/extension/src/<board>.js` that finds where the button goes and reads the
title/company, and wiring in the manifest and build. `trackerButton.js` does everything else
(shadow-DOM button, SPA navigation via MutationObserver, already-saved lookup, saving through
the service worker). StepStone (`stepstone.js`) is the most recent and simplest model to copy;
XING is the model for a single-page app with JSON-LD that can go stale.

## Adding a board — every touch point

1. **Study real postings first.** Get 2–3 real posting URLs, including one reached from a
   search results list. With the Claude in Chrome tools, open them and work out:
   - every URL shape the same posting appears under, and the stable numeric/opaque id in it;
   - which URL is canonical (strip tracking query params; keep whatever the site needs to
     resolve the page — e.g. XING's slug);
   - stable selectors: prefer `data-testid` / `data-at` / `data-*` attributes over generated
     class names; then JSON-LD `JobPosting` (`title`, `hiringOrganization.name`); then the tab
     title as a last resort;
   - the Apply / Save button row the button goes into, and whether it is duplicated in a
     sticky header (XING and StepStone both do this — exclude the sticky copy);
   - whether the site's UI is German, English, or both (label regexes cover both).
2. **`jobBoards.js`:** add a `<board>(url)` function returning `{ board, id, link }` or `null`,
   document its URL shapes in the header comment, and add it to the `||` chain in
   `postingFromUrl`. Hostname check with `/(^|\.)example\.de$/`, never `includes`.
3. **`extension/src/<board>.js`:** copy `stepstone.js`'s structure. Header docstring says
   what it reads (only title and company, of the posting on screen) and which selectors are
   used and why. Export nothing; end with
   `mountTrackerButton({ findAnchor, readPosting, style: STYLE, placement })`.
   - `placement: 'inline'` → `findAnchor()` returns the row item to insert after;
     `'below'` (LinkedIn) → returns the row, button goes on its own line under it.
   - `findAnchor()` must return `null` until the buttons have rendered.
   - On an SPA board, verify JSON-LD matches the title on screen before trusting it.
   - `STYLE` sizes the button like the site's own buttons, and sets font/colour explicitly.
   - The script name must match `/^[a-z]+$/` (the content-script build enforces it).
4. **`frontend/extension/public/manifest.json`:** add a `content_scripts` entry
   (`matches: ["https://www.<host>/*"]`, `js: ["<board>.js"]`, `run_at: "document_idle"`) and
   bump `version`. Don't add `host_permissions` for the board — content scripts don't need it.
5. **`frontend/package.json`:** append
   `&& CONTENT_SCRIPT=<board> vite build -c vite.extension.content.config.js` to `build:ext`.
6. **Comments that list the boards:** `trackerButton.js` header, `background.js` header,
   `vite.extension.content.config.js` comment.
7. **User-facing copy:** `frontend/src/components/PricingPage.jsx` (two mentions of
   "LinkedIn, XING and StepStone").
8. **Docs:** README — Features line, Project structure (`src/<board>.js`), a bullet under
   *Chrome extension* like the StepStone one (URL shape, canonical link, how duplicates are
   recognised), and the *What the extension reads* bullet. PLAN.md §6.4 item 1: mark it done
   with today's date.

## Fixing a board whose button disappeared

Sites change markup; the selectors at the top of each content script are what break.

1. Open a failing posting in Chrome; check `postingFromUrl(location.href)` still matches the
   URL (URL shape changes break `jobBoards.js`, not the content script).
2. Check each selector constant in the browser console in order; find the new stable
   attribute. Keep the old selector in the list as well if both versions may still be served
   (A/B rollouts are common).
3. Keep the label-regex fallbacks (`buttonByLabel`) working for German and English.

## Verify

```bash
scripts/check.sh frontend      # must build every content script
```

Then reload the unpacked extension (chrome://extensions → reload on *Job Tracker*, loaded from
`frontend/dist-extension`), open real postings — direct link, from search results, and after
navigating between postings without a reload — and confirm: the button appears once (not in
the sticky copy), saving fills the right title and company, and a second visit shows
*Tracked · To Be Applied*. The backend must be running and the extension signed in (see the
`run-app` skill).
