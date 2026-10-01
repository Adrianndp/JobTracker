/**
 * Content script for LinkedIn: puts an "Add to Job Tracker" button next to a
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
 * Where our button goes: right after Save, or after Apply if there's no Save.
 * Returns the node to insert after -- the child of the button row that holds the
 * target, so we sit in the row rather than inside LinkedIn's button wrapper.
 */
function findAnchor() {
  const main = document.querySelector('main') || document.body
  const apply = first(APPLY_SELECTORS, main) || buttonByLabel(APPLY_LABEL, main)
  if (!apply) return null

  // Walk up from Apply until we reach the row that also holds Save.
  let row = apply.parentElement
  for (let depth = 0; row && row !== main && depth < 5; depth += 1, row = row.parentElement) {
    const save = first(SAVE_SELECTORS, row) || buttonByLabel(SAVE_LABEL, row)
    if (save) return childOf(row, save)
  }
  return childOf(apply.parentElement, apply)
}

function childOf(row, el) {
  let node = el
  while (node.parentElement && node.parentElement !== row) node = node.parentElement
  return node
}

const STYLE = `
  :host { display: inline-flex; align-items: center; margin-left: 8px; vertical-align: middle; }
  button {
    font: inherit; font-size: 16px; font-weight: 600; line-height: 20px;
    padding: 6px 16px; min-height: 32px; border-radius: 24px; cursor: pointer;
    color: #057642; background: transparent; border: 1px solid #057642;
    display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  }
  button:hover { background: rgba(5, 118, 66, 0.08); box-shadow: inset 0 0 0 1px #057642; }
  button:disabled { cursor: default; opacity: 0.7; }
  button.saved { color: #fff; background: #057642; }
  button.saved:hover { background: #04603a; }
  button.error { color: #b24020; border-color: #b24020; }
  button.error:hover { background: rgba(178, 64, 32, 0.08); box-shadow: inset 0 0 0 1px #b24020; }
`

mountTrackerButton({ findAnchor, readPosting, style: STYLE })
