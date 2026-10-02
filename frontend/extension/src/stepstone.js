/**
 * Content script for StepStone: puts a "Save to Job Tracker" button next to a
 * posting's "Ich bin interessiert" / "Speichern" buttons (see trackerButton.js).
 *
 * It reads only the title and company of the posting on screen.
 *
 * StepStone marks its job page up with data-at attributes, which are steadier
 * than its generated class names. Fallbacks: the page's JobPosting JSON-LD, then
 * the tab title ("<title> - <contract>, ... Job in <city>") for the title.
 *
 * The header's buttons are rendered twice -- once in the header and once in a
 * sticky bar that appears on scroll. The button goes in the header only.
 */

import { buttonByLabel, first, HOST_ATTR, mountTrackerButton, text } from './trackerButton'

const HEADER_SELECTOR = '[data-at="job-ad-header"]'
const STICKY_SELECTOR = '[data-at="header-sticky-bar"]'
const TITLE_SELECTORS = [`${HEADER_SELECTOR} h1[data-at="header-job-title"]`, `${HEADER_SELECTOR} h1`]
const COMPANY_SELECTORS = ['[data-at="metadata-company-name"]']
const SAVE_SELECTOR = '[data-at="header-save-button"]'
// German and English UI; the data-at attributes above are tried first.
const SAVE_LABEL = /^(speichern|gespeichert|save|saved)\b/i
const APPLY_LABEL = /^(ich bin interessiert|jetzt bewerben|bewerben|i'm interested|apply)\b/i

const inSticky = (el) => Boolean(el.closest(STICKY_SELECTOR))

/** The hiring company and title from the page's JobPosting JSON-LD. */
function fromJsonLd() {
  const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent)
      if (data?.['@type'] === 'JobPosting') {
        return { name: clean(data.title), company: clean(data.hiringOrganization?.name) }
      }
    } catch {
      // not ours to fix
    }
  }
  return { name: '', company: '' }
}

/** "Frontend Developer (m/w/d) - Feste Anstellung, ... Job in Regensburg" -> the title */
function fromTabTitle() {
  return document.title.split(' - ')[0].trim()
}

function readPosting() {
  // Each StepStone posting is its own page load, so the JSON-LD always matches it.
  const ld = fromJsonLd()
  return {
    name: text(first(TITLE_SELECTORS)) || ld.name || fromTabTitle(),
    company: text(first(COMPANY_SELECTORS)) || ld.company,
  }
}

/**
 * Our button goes after "Speichern" in the header's button row, before the
 * "more" (report) menu, so that stays last. Returns the item to insert after.
 */
function findAnchor() {
  const header = document.querySelector(HEADER_SELECTOR)
  if (!header) return null
  const button = [...header.querySelectorAll(SAVE_SELECTOR)].find((b) => !inSticky(b))
    || [SAVE_LABEL, APPLY_LABEL].map((label) => buttonByLabel(label, header)).find((b) => b && !inSticky(b))
  if (!button) return null

  // Each button sits in its own wrapper; the row is the first ancestor holding several.
  let item = button
  while (item.parentElement && item.parentElement !== header && item.parentElement.childElementCount === 1) {
    item = item.parentElement
  }
  const row = item.parentElement
  if (!row || row === header) return item
  const items = [...row.children].filter((child) => !child.hasAttribute(HOST_ATTR))
  // The last item is the "more" menu when it holds just an icon button
  const last = items.at(-1)
  const isMenu = last && last !== item && !text(last)
  return (isMenu ? items.at(-2) : last) || item
}

// Sized like StepStone's 48px pill buttons. StepStone sets its font and text
// colour on each button rather than the row (which is a light grey), so both
// are set here.
const STYLE = `
  :host { display: flex; flex: 0 1 auto; min-width: 0; }
  button {
    height: 48px; padding: 0 22px 0 14px; font-size: 16px; font-weight: 700;
    font-family: "Relative Pro", Arial, sans-serif;
    color: #0c2577; border-width: 2px; --outline: color-mix(in srgb, #0c2577 35%, transparent);
    --outline-hover: #0c2577;
  }
  @media (max-width: 767.98px) {
    button { width: 48px; padding: 0; gap: 0; }
    .label, .detail { display: none; }
    .badge .logo { display: none; }
    .badge .plus { display: block; }
    .saved .badge .plus, .busy .badge .plus { display: none; }
  }
`

mountTrackerButton({ findAnchor, readPosting, style: STYLE, placement: 'inline' })
