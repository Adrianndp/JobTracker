/**
 * The bearer token lives in chrome.storage.local -- never localStorage, which
 * for an extension page is shared with nothing useful and survives less
 * predictably.
 *
 * A synchronous cache backed by a storage listener exists because api.ts calls
 * getToken() on every request, and an awaited storage read per API call is
 * needless latency. In the service worker there is no cache to rely on: MV3
 * terminates it after ~30s idle, so background.js always reads storage directly.
 */

const KEY = 'apiToken'

let cached = null
let loaded = false

export async function loadToken() {
  try {
    const { [KEY]: token } = await chrome.storage.local.get(KEY)
    cached = token || null
  } catch {
    cached = null
  }
  loaded = true
  return cached
}

/** Synchronous read for api.ts. Returns null until loadToken() has run once. */
export function getCachedToken() {
  return loaded ? cached : null
}

export async function setToken(token) {
  cached = token || null
  loaded = true
  if (token) await chrome.storage.local.set({ [KEY]: token })
  else await chrome.storage.local.remove(KEY)
}

export const clearToken = () => setToken(null)

/** Read straight from storage. Use this anywhere the cache can't be trusted. */
export async function readToken() {
  const { [KEY]: token } = await chrome.storage.local.get(KEY)
  return token || null
}

// Keep the cache honest when another extension page signs in or out.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) {
      cached = changes[KEY].newValue || null
      loaded = true
    }
  })
} catch {
  // not in an extension context (e.g. unit test) -- the cache just stays local
}
