/**
 * The "Add to Job Tracker" button shared by the job-board content scripts
 * (linkedin.js, xing.js). Each script says where the button goes and how to read
 * the title and company; this module does the rest. One click saves the posting
 * to the To Be Applied column.
 *
 * Job boards are single-page apps -- you move between postings without a page
 * load, and they re-render the job pane in place -- so this watches the DOM
 * instead of running once.
 *
 * Saving goes through the service worker, which holds the API token; nothing
 * here can see it.
 */

import { postingFromUrl } from './jobBoards'

const HOST_ATTR = 'data-job-tracker'

const STATUS_LABELS = {
  to_be_applied: 'To Be Applied',
  applied: 'Applied',
  in_interview: 'In Interview',
  rejected: 'Rejected',
  offer: 'Offer',
  ghosted: 'Ghosted',
}

export const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()

export function first(selectors, root = document) {
  for (const selector of selectors) {
    const el = root.querySelector(selector)
    if (el) return el
  }
  return null
}

export function buttonByLabel(pattern, root = document) {
  // Links too: an external "Apply on company website" is often a plain <a>.
  for (const el of root.querySelectorAll('button, a')) {
    const label = el.getAttribute('aria-label') || text(el)
    if (pattern.test(label.trim())) return el
  }
  return null
}

/**
 * The button lives in a shadow root so the page's CSS can't restyle it and ours
 * can't leak onto the page.
 */
function createButton(style) {
  const host = document.createElement('span')
  host.setAttribute(HOST_ATTR, '')
  const shadow = host.attachShadow({ mode: 'closed' })
  const styleEl = document.createElement('style')
  styleEl.textContent = style
  const button = document.createElement('button')
  button.type = 'button'
  shadow.append(styleEl, button)
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
  constructor(style, readPosting) {
    const { host, button } = createButton(style)
    this.host = host
    this.button = button
    this.readPosting = readPosting
    this.href = null
    this.link = null
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

  /**
   * Point the button at a (possibly new) posting and check whether it's saved.
   * link is the posting's canonical link, so moving between URLs of the same
   * posting doesn't re-check.
   */
  async bind(link, href) {
    if (link === this.link) return
    this.link = link
    this.href = href
    this.render('idle', '+ Add to Job Tracker', 'Save to the To Be Applied column')
    const res = await send({ type: 'find-board-job', href })
    if (this.link !== link) return // moved on to another posting meanwhile
    if (res?.ok && res.job) this.showJob(res.job)
    else if (res?.code === 'no-token') this.showError(res)
  }

  /** Check the current posting again, e.g. after signing in or out. */
  rebind() {
    const { link, href } = this
    if (!link) return
    this.link = null
    this.bind(link, href)
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

    const { link, href } = this
    const { name, company } = this.readPosting()
    if (!name || !company) {
      this.render('error', 'Could not read this posting', 'Use right-click → Save job to tracker instead')
      return
    }

    this.render('busy', 'Saving...')
    const res = await send({ type: 'save-board-job', href, name, company })
    if (this.link !== link) return
    if (res?.ok) this.showJob(res.job)
    else this.showError(res)
  }
}

/**
 * Keep a tracker button on the page whenever a posting is open.
 *
 * findAnchor() returns the node the button goes right after, or null while the
 * posting's buttons haven't rendered yet. readPosting() returns { name, company }
 * for the posting on screen. style is the CSS for the shadow root.
 */
export function mountTrackerButton({ findAnchor, readPosting, style }) {
  const tracker = new TrackerButton(style, readPosting)

  function sync() {
    const posting = postingFromUrl(location.href)
    if (!posting) {
      tracker.host.remove()
      return
    }
    const anchor = findAnchor()
    if (!anchor) return
    if (anchor.nextSibling !== tracker.host) anchor.after(tracker.host)
    tracker.bind(posting.link, location.href)
  }

  // The page mutates constantly; coalesce bursts into one sync per frame.
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
    if (area === 'local' && 'apiToken' in changes) tracker.rebind()
  })

  sync()
}
