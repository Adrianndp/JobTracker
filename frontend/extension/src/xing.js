/**
 * Content script for XING: puts a "Save to Job Tracker" button next to a
 * posting's "Einfach bewerben" / "Job merken" buttons (see trackerButton.js).
 *
 * It reads only the title and company of the posting on screen.
 *
 * XING marks its job page up with data-testid attributes, which are steadier than
 * its generated class names. Fallbacks: the tab title ("Job: <title> | XING
 * Jobs") for the title, and the page's JobPosting JSON-LD for the company.
 *
 * The job header's button row is rendered twice -- once in the header and once in
 * a sticky copy that appears on scroll. The button goes in the header only.
 */

import { buttonByLabel, first, HOST_ATTR, mountTrackerButton, text } from './trackerButton'

const HEADER_SELECTOR = '[data-testid="job-details-header"]'
const TITLE_SELECTORS = ['[data-testid="job-details-title"] h1', `${HEADER_SELECTOR} h1`]
const COMPANY_SELECTORS = ['[data-testid="job-details-company-info-name"]']
const SAVE_SELECTORS = ['[data-testid="job-details-bookmark-button"]']
const APPLY_SELECTORS = ['[data-testid="apply-button"]']
const MORE_SELECTOR = '[data-testid="job-details-more-menu-button"]'
// German and English UI; the test ids above are tried first.
const SAVE_LABEL = /^(job merken|gemerkt|save job|saved)\b/i
const APPLY_LABEL = /^(einfach bewerben|jetzt bewerben|bewerben|easy apply|apply)\b/i

/** "Job: Frontend Developer (m/w/x) | XING Jobs" -> "Frontend Developer (m/w/x)" */
function fromTabTitle() {
  const match = document.title.match(/^Job:\s*(.+?)\s*\|\s*XING/)
  return match ? match[1] : ''
}

/**
 * The hiring company from the page's JobPosting JSON-LD. Moving to a similar job
 * may not replace it, so it only counts if its title matches the one on screen.
 */
function companyFromJsonLd(name) {
  const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent)
      if (data?.['@type'] === 'JobPosting' && clean(data.title) === name) {
        return clean(data.hiringOrganization?.name)
      }
    } catch {
      // not ours to fix
    }
  }
  return ''
}

function readPosting() {
  const name = text(first(TITLE_SELECTORS)) || fromTabTitle()
  return {
    name,
    company: text(first(COMPANY_SELECTORS)) || companyFromJsonLd(name),
  }
}

/**
 * Our button goes at the right end of the "Einfach bewerben" / "Job merken" /
 * "Suchauftrag" row, but before the "more" menu (shown only on small screens),
 * so that stays last. Returns the item to insert after.
 */
function findAnchor() {
  const header = document.querySelector(HEADER_SELECTOR)
  if (!header) return null
  const button = first(SAVE_SELECTORS, header) || buttonByLabel(SAVE_LABEL, header)
    || first(APPLY_SELECTORS, header) || buttonByLabel(APPLY_LABEL, header)
  const row = button?.parentElement
  if (!row) return null
  const items = [...row.children].filter((item) => !item.hasAttribute(HOST_ATTR)
    && !item.matches(MORE_SELECTOR) && !item.querySelector(MORE_SELECTOR))
  return items.at(-1) || null
}

// Sized like XING's buttons; colours come from trackerButton.js.
// On wide screens XING gives every item in the row an equal share of its width
// (flex-basis: 100% on each), so the host takes one like its neighbours. Below
// 740px XING shrinks Job merken / Suchauftrag to round icon buttons, and ours
// follows suit: just the badge, with a plus while there's nothing saved yet.
const STYLE = `
  :host { display: flex; flex: 0 1 100%; min-width: 0; }
  button {
    width: 100%; height: 42px; padding: 0 16px 0 10px; font-size: 16px; font-weight: 700;
    border-width: 2px; --outline: currentColor;
  }
  @media (max-width: 739.98px) {
    :host { flex: none; }
    button { width: 42px; padding: 0; gap: 0; }
    .label, .detail { display: none; }
    .badge .logo { display: none; }
    .badge .plus { display: block; }
    .saved .badge .plus, .busy .badge .plus { display: none; }
  }
`

mountTrackerButton({ findAnchor, readPosting, style: STYLE, placement: 'inline' })
