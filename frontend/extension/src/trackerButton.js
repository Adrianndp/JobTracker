/**
 * The "Save to Job Tracker" button shared by the job-board content scripts
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

export const HOST_ATTR = 'data-job-tracker'

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

// The app's mark (the briefcase from the board header and favicon) on an
// indigo badge, plus the two glyphs that replace it while saving and once saved.
const BRAND = '#6366f1'
const LOGO = [
  ['rect', { x: 2, y: 7, width: 20, height: 14, rx: 2 }],
  ['path', { d: 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2' }],
]
const CHECK = [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]]
const PLUS = [['path', { d: 'M12 5v14M5 12h14' }]]
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Look shared by every board. Text and outline take the page's text colour
 * (currentColor), so the button follows a site's dark mode; the badge carries
 * the brand. Each content script appends its own rules to match the size and
 * shape of the site's buttons, and can set --outline / --outline-hover to match
 * how strong their outlines are.
 */
const BASE_STYLE = `
  button {
    --outline: color-mix(in srgb, currentColor 45%, transparent);
    --outline-hover: currentColor;
    box-sizing: border-box; max-width: 100%; height: 40px; padding: 0 16px 0 10px;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    font: inherit; font-size: 16px; font-weight: 600; line-height: 20px; letter-spacing: normal;
    color: inherit; background: transparent; cursor: pointer; white-space: nowrap;
    border: 1px solid var(--outline); border-radius: 999px; overflow: hidden;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  button:hover { background: color-mix(in srgb, currentColor 6%, transparent); border-color: var(--outline-hover); }
  button:focus-visible { outline: 2px solid ${BRAND}; outline-offset: 2px; }
  button:disabled { cursor: progress; }

  .badge {
    flex: none; width: 22px; height: 22px; border-radius: 6px;
    display: grid; place-items: center; color: #fff; background: ${BRAND};
  }
  .badge svg { width: 14px; height: 14px; }
  .badge .check, .badge .plus, .badge .spinner, .saved .badge .logo, .busy .badge .logo { display: none; }
  .saved .badge .check { display: block; }
  .busy .badge .spinner { display: block; }
  .spinner {
    width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }

  /* When space is short the column name gives way first. */
  .label, .detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .label { flex: 0 1 auto; }
  .detail { flex: 0 10 auto; font-size: 0.875em; font-weight: 400; opacity: 0.75; }
  .detail:empty { display: none; }
  .detail::before { content: '· '; }

  .saved {
    background: color-mix(in srgb, ${BRAND} 10%, transparent);
    border-color: color-mix(in srgb, ${BRAND} 45%, transparent);
  }
  .saved:hover { background: color-mix(in srgb, ${BRAND} 16%, transparent); border-color: ${BRAND}; }
  .error { color: #d93025; border-color: color-mix(in srgb, #d93025 55%, transparent); }
  .error:hover { background: color-mix(in srgb, #d93025 8%, transparent); border-color: #d93025; }
`

// Appended after a site's rules so it wins over their spacing and size.
const LAYOUT_STYLE = `
  :host([data-gapped]) button { margin-top: 0; }
  :host([data-compact]) button { height: 32px; padding: 0 12px 0 6px; gap: 6px; font-size: 14px; }
  :host([data-compact]) .badge { width: 20px; height: 20px; border-radius: 5px; }
  :host([data-compact]) .badge svg { width: 12px; height: 12px; }
`

// Built with DOM calls rather than innerHTML: LinkedIn enforces Trusted Types,
// which rejects HTML strings.
function el(tag, attrs, children = []) {
  const node = tag === 'span' ? document.createElement(tag) : document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value))
  node.append(...children)
  return node
}

function icon(className, shapes) {
  return el('svg', {
    class: className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, shapes.map(([tag, attrs]) => el(tag, attrs)))
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
  styleEl.textContent = BASE_STYLE + style + LAYOUT_STYLE
  const button = document.createElement('button')
  button.type = 'button'
  button.append(
    el('span', { class: 'badge' }, [
      icon('logo', LOGO), icon('plus', PLUS), icon('check', CHECK), el('span', { class: 'spinner' }),
    ]),
    el('span', { class: 'label' }),
    el('span', { class: 'detail' }),
  )
  shadow.append(styleEl, button)
  return { host, button }
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message)
  } catch {
    // The extension was reloaded or updated after this page loaded, which cuts
    // the old content script off from the worker.
    return { ok: false, error: 'Job Tracker was updated. Reload the page to continue.' }
  }
}

/** One button, bound to whichever posting is on screen. */
class TrackerButton {
  constructor(style, readPosting) {
    const { host, button } = createButton(style)
    this.host = host
    this.button = button
    this.label = button.querySelector('.label')
    this.detail = button.querySelector('.detail')
    this.readPosting = readPosting
    this.href = null
    this.link = null
    this.state = 'idle'
    button.addEventListener('click', () => this.onClick())
  }

  /** title is the tooltip; the accessible name is the visible text plus it. */
  render(state, label, { detail = '', title = '' } = {}) {
    this.state = state
    this.button.className = state
    this.button.disabled = state === 'busy'
    this.label.textContent = label
    this.detail.textContent = detail
    this.button.title = title
    this.button.setAttribute('aria-label', [label, detail, title].filter(Boolean).join('. '))
  }

  showJob(job) {
    this.render('saved', 'Tracked', {
      detail: STATUS_LABELS[job.status] || '',
      title: 'Open your Job Tracker board',
    })
  }

  showError(res) {
    if (res?.code === 'no-token') {
      this.render('signin', 'Sign in to save', { title: 'Sign in to Job Tracker to save jobs from this page' })
    } else if (res?.code === 'plan_limit') {
      this.render('limit', 'Free limit reached', { detail: 'Upgrade', title: res.error || '' })
    } else {
      this.render('error', 'Couldn’t save', { detail: 'Retry', title: res?.error || '' })
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
    this.render('idle', 'Save to Job Tracker', { title: 'Add this job to your To Be Applied column' })
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
    if (this.state === 'limit') {
      send({ type: 'open-upgrade' })
      return
    }
    if (this.state === 'signin') {
      const res = await send({ type: 'open-panel' })
      if (!res?.ok) {
        this.render('signin', 'Sign in from the toolbar', {
          title: 'Click the Job Tracker icon in Chrome’s toolbar to sign in',
        })
      }
      return
    }

    const { link, href } = this
    const { name, company } = this.readPosting()
    if (!name || !company) {
      this.render('error', 'Couldn’t read this job', {
        title: 'Right-click the page and choose “Save to Job Tracker” to enter it yourself',
      })
      return
    }

    this.render('busy', 'Saving…')
    const res = await send({ type: 'save-board-job', href, name, company })
    if (this.link !== link) return
    if (res?.ok) this.showJob(res.job)
    else this.showError(res)
  }
}

/**
 * The node to insert the button after so it gets a line of its own under row.
 *
 * That is row itself when row's parent stacks its children vertically (a block,
 * or a column flexbox). Otherwise -- a flex row puts us beside it, and a grid
 * may put us in the same cell, on top of it (LinkedIn's redesigned job page
 * does) -- it is the nearest ancestor of row whose parent does stack them.
 */
function lineAfter(row) {
  let node = row
  for (let depth = 0; depth < 6; depth += 1) {
    const parent = node.parentElement
    if (!parent || parent === document.body) break
    const { display, flexDirection } = getComputedStyle(parent)
    const stacks = ['block', 'flow-root', 'list-item'].includes(display)
      || (/flex$/.test(display) && flexDirection.startsWith('column'))
    if (stacks) return node
    node = parent
  }
  return row
}

/**
 * Keep a tracker button on the page whenever a posting is open.
 *
 * findAnchor() returns null while the posting's buttons haven't rendered yet,
 * and otherwise depends on placement:
 * - 'below': the site's Apply / Save row; the button goes on its own line
 *   under it (see lineAfter).
 * - 'inline': the item in the row that the button goes right after.
 * readPosting() returns { name, company } for the posting on screen. style is
 * the CSS for the shadow root.
 */
export function mountTrackerButton({ findAnchor, readPosting, style, placement = 'below' }) {
  const tracker = new TrackerButton(style, readPosting)

  function sync() {
    const posting = postingFromUrl(location.href)
    if (!posting) {
      tracker.host.remove()
      return
    }
    const found = findAnchor()
    if (!found) return
    const anchor = placement === 'inline' ? found : lineAfter(found)
    if (anchor.nextSibling !== tracker.host) {
      anchor.after(tracker.host)
      if (placement === 'below') {
        // A parent that spaces its children with gap already puts room above us.
        const gap = parseFloat(getComputedStyle(anchor.parentElement).rowGap) || 0
        tracker.host.toggleAttribute('data-gapped', gap > 0)
        // Match a row of small buttons (LinkedIn's redesigned job page uses 32px).
        tracker.host.toggleAttribute('data-compact', found.getBoundingClientRect().height < 36)
      }
    }
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
