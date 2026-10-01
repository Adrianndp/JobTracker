/**
 * MV3 service worker: the only place that talks to the API during a save.
 *
 * It is terminated after ~30s idle, so nothing here is cached in a module
 * variable -- the token and API host are read from chrome.storage on every use.
 *
 * The side panel and context menu build a draft from tab metadata only (title,
 * URL, and any text you had selected when you opened the menu). The one place
 * that reads page content is the LinkedIn content script (linkedin.js), which
 * sends the title and company it finds there to this worker to save.
 */

import { canonicalLinkedInLink, linkedInJobId } from './linkedinUrl'
import { getApiBase } from './settings'
import { clearToken, readToken } from './tokenStore'

const MENU_ID = 'save-job'
const PENDING_KEY = 'pendingJob'

// Mirrors the server-side caps in backend/jobs/validators.py. Trimming here is a
// courtesy so the panel shows what will actually be saved; the server is the
// control, not this.
const MAX = { name: 200, company: 200, link: 500 }

function tidy(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Save job to tracker',
      contexts: ['page', 'link', 'selection'],
    })
  })
})

// Clicking the toolbar icon opens the side panel (Chrome 116+).
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {})

async function badge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color })
    await chrome.action.setBadgeText({ text })
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000)
  } catch {
    // badges are cosmetic
  }
}

function notSignedIn(message) {
  const error = new Error(message)
  error.code = 'no-token'
  return error
}

async function apiFetch(path, init = {}) {
  const [base, token] = await Promise.all([getApiBase(), readToken()])
  if (!token) throw notSignedIn('Not signed in')

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  })

  if (res.status === 401) {
    await clearToken()
    throw notSignedIn('Session expired')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

function createJob(job) {
  return apiFetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: job.name,
      company: job.company,
      link: job.link,
      salary: job.salary,
    }),
  })
}

/** The saved job for a LinkedIn posting id, or null. */
async function findLinkedInJob(id) {
  const jobs = await apiFetch('/api/jobs')
  return jobs.find((job) => job.link && linkedInJobId(job.link) === id) || null
}

/**
 * What we can know about a tab without touching the page.
 *
 * info comes from a context-menu click and is optional: selectionText lets you
 * highlight the real job title first, and linkUrl lets you save a posting from
 * a results list without opening it.
 */
function draftFromTab(tab, info = {}) {
  return {
    name: tidy(info.selectionText || tab?.title || '', MAX.name),
    company: '',
    salary: '',
    link: tidy(info.linkUrl || info.pageUrl || tab?.url || '', MAX.link),
  }
}

/** Stash a draft the panel should pick up, then open the panel. */
async function handOffToPanel(job, tabId, reason) {
  await chrome.storage.local.set({ [PENDING_KEY]: { job, reason, at: Date.now() } })
  try {
    await chrome.sidePanel.open({ tabId })
  } catch {
    // open() needs a user gesture; the click that got us here counts, but if
    // Chrome disagrees the panel will show the pending job next time it opens.
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return
  // Always confirm before saving -- a tab title is rarely the job title on its
  // own, and silently storing it would be worse than one extra click.
  handOffToPanel(draftFromTab(tab, info), tab?.id, 'Add the company, then save.')
})

// Messages from the side panel / board page, and the LinkedIn content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fail = (error) => sendResponse({ ok: false, error: String(error.message), code: error.code })

  if (message?.type === 'save-job') {
    createJob(message.job)
      .then((job) => {
        badge('OK', '#16a34a')
        chrome.runtime.sendMessage({ type: 'job-created', job }).catch(() => {})
        sendResponse({ ok: true, job })
      })
      .catch(fail)
    return true
  }

  // From the LinkedIn button. The link is rebuilt from the posting id here rather
  // than taken from the page, so every save of a posting stores the same URL.
  if (message?.type === 'save-linkedin-job') {
    const id = String(message.id || '')
    if (!/^\d+$/.test(id)) {
      sendResponse({ ok: false, error: 'Not a LinkedIn job page.' })
      return undefined
    }
    findLinkedInJob(id)
      .then((existing) => existing || createJob({
        name: tidy(message.name, MAX.name),
        company: tidy(message.company, MAX.company),
        link: canonicalLinkedInLink(id),
      }).then((job) => {
        badge('OK', '#16a34a')
        chrome.runtime.sendMessage({ type: 'job-created', job }).catch(() => {})
        return job
      }))
      .then((job) => sendResponse({ ok: true, job }))
      .catch(fail)
    return true
  }

  if (message?.type === 'find-linkedin-job') {
    findLinkedInJob(String(message.id || ''))
      .then((job) => sendResponse({ ok: true, job }))
      .catch(fail)
    return true
  }

  if (message?.type === 'open-board') {
    chrome.tabs.create({ url: chrome.runtime.getURL('board.html') })
    return undefined
  }

  // Sent from a click on the LinkedIn button; Chrome treats a message sent from a
  // content script's click handler as the user gesture sidePanel.open() needs.
  if (message?.type === 'open-panel' && sender.tab?.id != null) {
    chrome.sidePanel.open({ tabId: sender.tab.id })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message) }))
    return true
  }

  if (message?.type === 'read-active-tab') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => {
        const job = draftFromTab(tab)
        // activeTab is granted by the click that opened the panel and lapses on
        // navigation, so url/title can come back empty once you browse on. The
        // context menu re-grants it on every click, hence the hint.
        if (!job.link) throw new Error('Use right-click → Save job to tracker on the page.')
        return job
      })
      .then((job) => sendResponse({ ok: true, job }))
      .catch(fail)
    return true
  }

  return undefined
})
