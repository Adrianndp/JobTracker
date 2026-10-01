/**
 * Content script for XING: puts an "Add to Job Tracker" button next to a
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

/** Right after "Job merken", or after "Einfach bewerben" if there's no bookmark. */
function findAnchor() {
  const header = document.querySelector(HEADER_SELECTOR)
  if (!header) return null
  return first(SAVE_SELECTORS, header) || buttonByLabel(SAVE_LABEL, header)
    || first(APPLY_SELECTORS, header) || buttonByLabel(APPLY_LABEL, header)
}

// On wide screens XING lays the row out as equal-width flex items
// (flex-basis: 100% on every child), so the host takes a share like its
// neighbours and the button fills it.
const STYLE = `
  :host { display: flex; flex: 0 1 100%; min-width: 0; }
  button {
    font: inherit; font-size: 16px; font-weight: 700; line-height: 18px;
    width: 100%; min-height: 42px; padding: 0 21px; border-radius: 50px; cursor: pointer;
    color: #1d2124; background: transparent; border: 2px solid #1d2124;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  button:hover { background: rgba(29, 33, 36, 0.06); }
  button:disabled { cursor: default; opacity: 0.7; }
  button.saved { color: #1d2124; background: #c6f16d; border-color: #c6f16d; }
  button.saved:hover { background: #b5e05c; border-color: #b5e05c; }
  button.error { color: #b24020; border-color: #b24020; }
  button.error:hover { background: rgba(178, 64, 32, 0.08); }
`

mountTrackerButton({ findAnchor, readPosting, style: STYLE })
