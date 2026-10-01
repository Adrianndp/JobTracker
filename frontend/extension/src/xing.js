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

import { buttonByLabel, first, mountTrackerButton, text } from './trackerButton'

const HEADER_SELECTOR = '[data-testid="job-details-header"]'
const TITLE_SELECTORS = ['[data-testid="job-details-title"] h1', `${HEADER_SELECTOR} h1`]
const COMPANY_SELECTORS = ['[data-testid="job-details-company-info-name"]']
const SAVE_SELECTORS = ['[data-testid="job-details-bookmark-button"]']
const APPLY_SELECTORS = ['[data-testid="apply-button"]']
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
 * Our button goes on its own line under the "Einfach bewerben" / "Job merken"
 * row: XING gives every button in that row an equal share of its width, which
 * leaves too little room for ours. Returns that row, which the button is
 * inserted after.
 */
function findAnchor() {
  const header = document.querySelector(HEADER_SELECTOR)
  if (!header) return null
  const button = first(SAVE_SELECTORS, header) || buttonByLabel(SAVE_LABEL, header)
    || first(APPLY_SELECTORS, header) || buttonByLabel(APPLY_LABEL, header)
  return button?.parentElement || null
}

// Sized like XING's "Job merken" button; colours come from trackerButton.js.
const STYLE = `
  :host { display: flex; }
  button {
    margin-top: 12px; height: 42px; padding: 0 20px 0 12px; font-size: 16px; font-weight: 700;
    border-width: 2px; --outline: currentColor;
  }
`

mountTrackerButton({ findAnchor, readPosting, style: STYLE })
