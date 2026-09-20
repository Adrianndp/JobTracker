/** Where the backend lives. Build-time default, overridable at runtime. */

const KEY = 'apiBase'
const BUILD_DEFAULT = (import.meta.env?.VITE_API_BASE || 'http://localhost:5001').replace(/\/+$/, '')

export async function getApiBase() {
  try {
    const { [KEY]: stored } = await chrome.storage.local.get(KEY)
    return (stored || BUILD_DEFAULT).replace(/\/+$/, '')
  } catch {
    return BUILD_DEFAULT
  }
}

export async function setApiBase(value) {
  const base = String(value || '').trim().replace(/\/+$/, '')
  if (!base) {
    await chrome.storage.local.remove(KEY)
    return BUILD_DEFAULT
  }
  const url = new URL(base) // throws on nonsense, which the caller reports
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The API host must be an http(s) URL.')
  }
  await chrome.storage.local.set({ [KEY]: base })
  return base
}

export { BUILD_DEFAULT as defaultApiBase }

/** Ask for host access to a user-chosen backend (optional_host_permissions). */
export async function ensureHostPermission(base) {
  const origin = new URL(base).origin + '/*'
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true
    return await chrome.permissions.request({ origins: [origin] })
  } catch {
    return false
  }
}
