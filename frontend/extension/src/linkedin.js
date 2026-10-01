/**
 * Content script for LinkedIn: puts an "Add to Job Tracker" button next to a
 * posting's Apply / Save buttons. One click saves the title, company and link to
 * the To Be Applied column.
 *
 * LinkedIn is a single-page app -- you move from the feed into jobs, and between
 * postings in a results list, without a page load, and it re-renders the job pane
 * in place -- so this watches the DOM instead of running once.
 *
 * It reads only the title and company of the posting on screen. Saving goes
 * through the service worker, which holds the API token; nothing here can see it.
 *
 * LinkedIn's markup changes often, so every lookup has fallbacks, ending with the
 * tab title ("<title> | <company> | LinkedIn") and a "Apply"-labelled button.
 */

import { linkedInJobId } from './linkedinUrl'

const HOST_ATTR = 'data-job-tracker'

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

const STATUS_LABELS = {
  to_be_applied: 'To Be Applied',
  applied: 'Applied',
  in_interview: 'In Interview',
  rejected: 'Rejected',
  offer: 'Offer',
  ghosted: 'Ghosted',
}

const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()

function first(selectors, root = document) {
  for (const selector of selectors) {
    const el = root.querySelector(selector)
    if (el) return el
  }
  return null
}

function buttonByLabel(pattern, root = document) {
  // Links too: on /jobs/view/ pages an external "Apply on company website" is a
  // plain <a>, not a button.
  for (const el of root.querySelectorAll('button, a')) {
    const label = el.getAttribute('aria-label') || text(el)
    if (pattern.test(label.trim())) return el
  }
  return null
}

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

/**
 * The button lives in a shadow root so LinkedIn's CSS can't restyle it and ours
 * can't leak onto the page.
 */
function createButton() {
  const host = document.createElement('span')
  host.setAttribute(HOST_ATTR, '')
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLE
  const button = document.createElement('button')
  button.type = 'button'
  shadow.append(style, button)
  return { host, button }
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message)
  } catch {
    // The extension was reloaded or updated after this page loaded, which cuts
    // the old content script off from the worker.
    return { ok: false, error: 'Extension was updated -- reload this page.' }
  }
}

/** One button, bound to whichever posting is on screen. */
class TrackerButton {
  constructor() {
    const { host, button } = createButton()
    this.host = host
    this.button = button
    this.jobId = null
    this.state = 'idle'
    button.addEventListener('click', () => this.onClick())
  }

  render(state, label, title = '') {
    this.state = state
    this.button.className = state
    this.button.disabled = state === 'busy'
    this.button.textContent = label
    this.button.title = title
  }

  showJob(job) {
    const column = STATUS_LABELS[job.status] || 'your board'
    this.render('saved', `✓ In tracker · ${column}`, 'Open your board')
  }

  showError(res) {
    if (res?.code === 'no-token') {
      this.render('signin', 'Sign in to Job Tracker', 'Opens the Job Tracker panel')
    } else {
      this.render('error', 'Could not save -- retry', res?.error || '')
    }
  }

  /** Point the button at a (possibly new) posting and check whether it's saved. */
  async bind(jobId) {
    if (jobId === this.jobId) return
    this.jobId = jobId
    this.render('idle', '+ Add to Job Tracker', 'Save to the To Be Applied column')
    const res = await send({ type: 'find-linkedin-job', id: jobId })
    if (this.jobId !== jobId) return // moved on to another posting meanwhile
    if (res?.ok && res.job) this.showJob(res.job)
    else if (res?.code === 'no-token') this.showError(res)
  }

  async onClick() {
    if (this.state === 'busy') return
    if (this.state === 'saved') {
      send({ type: 'open-board' })
      return
    }
    if (this.state === 'signin') {
      const res = await send({ type: 'open-panel' })
      if (!res?.ok) this.render('signin', 'Click the Job Tracker icon to sign in')
      return
    }

    const jobId = this.jobId
    const { name, company } = readPosting()
    if (!name || !company) {
      this.render('error', 'Could not read this posting', 'Use right-click → Save job to tracker instead')
      return
    }

    this.render('busy', 'Saving...')
    const res = await send({ type: 'save-linkedin-job', id: jobId, name, company })
    if (this.jobId !== jobId) return
    if (res?.ok) this.showJob(res.job)
    else this.showError(res)
  }
}

const tracker = new TrackerButton()

function sync() {
  const jobId = linkedInJobId(location.href)
  if (!jobId) {
    tracker.host.remove()
    return
  }
  const anchor = findAnchor()
  if (!anchor) return
  if (anchor.nextSibling !== tracker.host) anchor.after(tracker.host)
  tracker.bind(jobId)
}

// LinkedIn mutates the page constantly; coalesce bursts into one sync per frame.
let scheduled = false
new MutationObserver(() => {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    sync()
  })
}).observe(document.documentElement, { childList: true, subtree: true })

// Signing in (or out) from the panel should take effect without a page reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'apiToken' in changes && tracker.jobId) {
    const jobId = tracker.jobId
    tracker.jobId = null
    tracker.bind(jobId)
  }
})

sync()
