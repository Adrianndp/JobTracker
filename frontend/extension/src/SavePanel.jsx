import { useCallback, useEffect, useState } from 'react'
import { useAuthStatus, useJobs, useUnauthorized } from '@app/api'
import { safeHref } from '@app/lib/safeUrl'
import LoginPage from '@app/components/LoginPage'
import { postingFromUrl } from './jobBoards'
import { API_HOST_FIXED, defaultApiBase, ensureHostPermission, getApiBase, setApiBase } from './settings'
import { clearToken, getCachedToken, setToken } from './tokenStore'
import styles from './SavePanel.module.css'

const PENDING_KEY = 'pendingJob'
const EMPTY = { name: '', company: '', salary: '', link: '' }
const MAX_LINK = 500 // backend/jobs/validators.py

function openBoard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('board.html') })
}

/**
 * The panel's own title bar. Chrome draws its side-panel header itself and
 * doesn't let extensions handle clicks on it, so this is the brand you can click
 * to get to the board.
 */
function BrandHeader() {
  return (
    <button type="button" className={styles.brand} onClick={openBoard} title="Open your full board in a new tab">
      <span className={styles.brandBadge} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
        </svg>
      </span>
      <span className={styles.brandName}>Job Tracker</span>
      <svg className={styles.brandOpen} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
    </button>
  )
}

function SettingsRow({ onChanged }) {
  if (API_HOST_FIXED) return null
  return <ApiHostSetting onChanged={onChanged} />
}

function ApiHostSetting({ onChanged }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { getApiBase().then(setValue) }, [])

  const save = async () => {
    setError('')
    try {
      const base = await setApiBase(value)
      if (!(await ensureHostPermission(base))) {
        setError('Permission for that host was declined.')
        return
      }
      onChanged(base)
      setOpen(false)
    } catch {
      setError('Enter a full URL, e.g. https://jobs.example.com')
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.settingsToggle} onClick={() => setOpen(true)}>
        Backend: {value || defaultApiBase}
      </button>
    )
  }

  return (
    <div className={styles.settings}>
      <label className={styles.label} htmlFor="apiBase">API host</label>
      <input
        id="apiBase"
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={defaultApiBase}
      />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.row}>
        <button type="button" className={styles.secondaryBtn} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className={styles.primaryBtn} onClick={save}>Save</button>
      </div>
    </div>
  )
}

function SaveForm({ onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const adopt = useCallback((job, reason) => {
    setForm({ ...EMPTY, ...job })
    setNote(reason || '')
  }, [])

  // A save started from the context menu parks the draft in storage and opens
  // this panel; pick it up on mount and whenever a new one lands.
  useEffect(() => {
    let cancelled = false
    chrome.storage.local.get(PENDING_KEY).then(({ [PENDING_KEY]: pending }) => {
      if (!cancelled && pending?.job) {
        adopt(pending.job, pending.reason)
        chrome.storage.local.remove(PENDING_KEY)
      }
    })
    const listener = (changes, area) => {
      if (area === 'local' && changes[PENDING_KEY]?.newValue?.job) {
        adopt(changes[PENDING_KEY].newValue.job, changes[PENDING_KEY].newValue.reason)
        chrome.storage.local.remove(PENDING_KEY)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => { cancelled = true; chrome.storage.onChanged.removeListener(listener) }
  }, [adopt])

  // Chrome hides a tab's URL unless we hold the "tabs" permission or activeTab,
  // and activeTab (granted by the toolbar click that opened the panel) lapses as
  // soon as the tab navigates -- so with the panel left open while you browse,
  // every new page would be unreadable. "tabs" is optional and asked for here,
  // once: request() resolves straight away without a prompt when already
  // granted. It has to be the first await, while the click still counts as a
  // user gesture.
  const useCurrentLink = async () => {
    setError('')
    const granted = await chrome.permissions.request({ permissions: ['tabs'] }).catch(() => false)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) {
      setError(granted
        ? 'Can\'t read this tab\'s link.'
        : 'Allow the extension to read tab links to use this.')
      return
    }
    // Job-board URLs carry search state and tracking parameters (a LinkedIn
    // search URL holds the open posting as ?currentJobId=); store the posting's
    // canonical link, as the job-board buttons do.
    const link = postingFromUrl(tab.url)?.link || tab.url
    setForm((f) => ({ ...f, link: link.slice(0, MAX_LINK) }))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('Job title is required.')
    if (!form.company.trim()) return setError('Company is required.')
    setError('')
    setBusy(true)
    try {
      const res = await chrome.runtime.sendMessage({ type: 'save-job', job: form })
      if (res?.ok) {
        setForm(EMPTY)
        setNote('')
        onSaved(res.job)
      } else {
        setError(res?.error || 'Could not save.')
      }
    } finally {
      setBusy(false)
    }
  }

  const href = safeHref(form.link)

  return (
    <form className={styles.form} onSubmit={submit}>
      {note && <p className={styles.note}>{note}</p>}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="name">Job title</label>
        <input id="name" className={styles.input} value={form.name} onChange={set('name')} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="company">Company</label>
        <input id="company" className={styles.input} value={form.company} onChange={set('company')} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="salary">Salary</label>
        <input id="salary" className={styles.input} value={form.salary} onChange={set('salary')} />
      </div>
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label className={styles.label} htmlFor="link">Link</label>
          <button type="button" className={styles.inlineBtn} onClick={useCurrentLink}>
            Use current link
          </button>
        </div>
        <input id="link" className={styles.input} value={form.link} onChange={set('link')} />
        {href && <a className={styles.preview} href={href} target="_blank" rel="noopener noreferrer">Open posting</a>}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <button type="submit" className={styles.primaryBtn} disabled={busy}>
        {busy ? 'Saving...' : 'Save to To Be Applied'}
      </button>
    </form>
  )
}

function RecentSaves({ refreshKey }) {
  const { jobs, setJobs } = useJobs(true)

  useEffect(() => {
    const listener = (message) => {
      if (message?.type === 'job-created') setJobs((prev) => [message.job, ...prev])
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [setJobs])

  const recent = jobs.slice(0, 5)
  if (!recent.length) return null

  return (
    <div className={styles.recent} key={refreshKey}>
      <h2 className={styles.recentTitle}>Recently saved</h2>
      <ul className={styles.recentList}>
        {recent.map((job) => (
          <li key={job.id} className={styles.recentItem}>
            <span className={styles.recentName}>{job.name}</span>
            <span className={styles.recentCompany}>{job.company}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SavePanel({ onApiBaseChanged }) {
  const authStatus = useAuthStatus()
  const [session, setSession] = useState(() => (getCachedToken() ? undefined : 'login'))
  const [saved, setSaved] = useState(0)

  useUnauthorized(() => {
    clearToken()
    setSession('login')
  })

  const authed = session === 'authed'
    || (session === undefined && authStatus.data?.authenticated)

  if (session !== 'login' && authStatus.loading) {
    return <div className={styles.panel}><p className={styles.note}>Connecting...</p></div>
  }

  if (!authed) {
    return (
      <div className={styles.panel}>
        <LoginPage
          authMode="token"
          onAuthenticated={async (_username, grant) => {
            if (grant?.token) await setToken(grant.token)
            setSession('authed')
          }}
        />
        <SettingsRow onChanged={onApiBaseChanged} />
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <BrandHeader />
      <SaveForm onSaved={() => setSaved((n) => n + 1)} />
      <RecentSaves refreshKey={saved} />
      <SettingsRow onChanged={onApiBaseChanged} />
    </div>
  )
}
