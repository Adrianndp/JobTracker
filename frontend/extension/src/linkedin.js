/**
 * Content script for LinkedIn: puts a "Save to Job Tracker" button next to a
 * posting's Apply / Save buttons (see trackerButton.js).
 *
 * It reads only the title and company of the posting on screen.
 *
 * LinkedIn's markup changes often, so every lookup has fallbacks, ending with the
 * tab title ("<title> | <company> | LinkedIn") and a "Apply"-labelled button.
 */

import { buttonByLabel, first, mountTrackerButton, text } from './trackerButton'

const TITLE_SELECTORS = [
  '.job-details-jobs-unified-top-card__job-title h1',
  '.job-details-jobs-unified-top-card__job-title',
  '.jobs-unified-top-card__job-title',
  '.top-card-layout__title',
]
const COMPANY_SELECTORS = [
  '.job-details-jobs-unified-top-card__company-name a',
  '.job-details-jobs-unified-top-card__company-name',
  '.jobs-unified-top-card__company-name a',
  '.jobs-unified-top-card__company-name',
  '.topcard__org-name-link',
]
const APPLY_SELECTORS = ['.jobs-apply-button--top-card', '.jobs-s-apply', '.jobs-apply-button']
const SAVE_SELECTORS = ['.jobs-save-button']
// English and German UI; the class selectors above are tried first.
const APPLY_LABEL = /^(easy apply|apply|einfach bewerben|bewerben|jetzt bewerben)\b/i
const SAVE_LABEL = /^(save|speichern)\b/i

/** "(3) Full Stack Engineer | adesso SE | LinkedIn" -> [title, company] */
function fromTabTitle() {
  const parts = document.title.replace(/^\(\d+\)\s*/, '').split(' | ')
  return parts.length >= 3 ? [parts[0].trim(), parts[1].trim()] : ['', '']
}

function readPosting() {
  const [tabTitle, tabCompany] = fromTabTitle()
  return {
    name: text(first(TITLE_SELECTORS)) || tabTitle,
    company: text(first(COMPANY_SELECTORS)) || tabCompany,
  }
}

/**
 * Our button goes on its own line under the Apply / Save row: inside the row it
 * runs out of the job pane when Apply is wide ("Apply on company website").
 * Returns that row, which the button is inserted after.
 */
function findAnchor() {
  const main = document.querySelector('main') || document.body
  const apply = first(APPLY_SELECTORS, main) || buttonByLabel(APPLY_LABEL, main)
  if (!apply) return null

  // Walk up from Apply until we reach the row that also holds Save.
  let row = apply.parentElement
  for (let depth = 0; row && row !== main && depth < 5; depth += 1, row = row.parentElement) {
    const save = first(SAVE_SELECTORS, row) || buttonByLabel(SAVE_LABEL, row)
    if (save) return row
  }
  return rowOf(apply)
}

/** The row around el: its nearest ancestor holding more than el's own wrappers. */
function rowOf(el) {
  let node = el
  while (node.parentElement?.childElementCount === 1) node = node.parentElement
  return node.parentElement || node
}

// Sized like LinkedIn's Apply / Save pills; colours come from trackerButton.js.
// The spacing sits on the button: LinkedIn's reset zeroes margins on the host.
const STYLE = `
  :host { display: flex; }
  button { margin-top: 8px; height: 40px; padding: 0 16px 0 9px; font-size: 16px; font-weight: 600; }
`

mountTrackerButton({ findAnchor, readPosting, style: STYLE })
