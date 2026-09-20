/**
 * MV3 service worker: the only place that talks to the API during a save.
 *
 * It is terminated after ~30s idle, so nothing here is cached in a module
 * variable -- the token and API host are read from chrome.storage on every use.
 *
 * Nothing in this extension reads page content. A save is prefilled from tab
 * metadata only (title, URL, and any text you had selected when you opened the
 * menu), which needs no script injection and no host permission for the page.
 */

import { getApiBase } from './settings'
import { clearToken, readToken } from './tokenStore'

const MENU_ID = 'save-job'
const PENDING_KEY = 'pendingJob'

// Mirrors the server-side caps in backend/jobs/validators.py. Trimming here is a
// courtesy so the panel shows what will actually be saved; the server is the
// control, not this.
const MAX = { name: 200, link: 500 }

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

async function createJob(job) {
  const [base, token] = await Promise.all([getApiBase(), readToken()])
  if (!token) {
    const error = new Error('Not signed in')
    error.code = 'no-token'
    throw error
  }

  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: job.name,
      company: job.company,
      link: job.link,
      salary: job.salary,
    }),
  })

  if (res.status === 401) {
    await clearToken()
    const error = new Error('Session expired')
    error.code = 'no-token'
    throw error
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`)
  return data
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

// Messages from the side panel / board page.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'save-job') {
    createJob(message.job)
      .then((job) => {
        badge('OK', '#16a34a')
        chrome.runtime.sendMessage({ type: 'job-created', job }).catch(() => {})
        sendResponse({ ok: true, job })
      })
      .catch((error) => sendResponse({ ok: false, error: String(error.message), code: error.code }))
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
      .catch((error) => sendResponse({ ok: false, error: String(error.message) }))
    return true
  }

  return undefined
})
