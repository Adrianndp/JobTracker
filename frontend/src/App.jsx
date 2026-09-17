import { useState, useEffect, useMemo } from 'react'
import KanbanBoard, { COLUMNS } from './components/KanbanBoard'
import AddJobModal from './components/AddJobModal'
import CompanyFilter from './components/CompanyFilter'
import LoginPage from './components/LoginPage'
import styles from './App.module.css'

const API = '/api/jobs'

export default function App() {
  // status: 'checking' | 'setup' | 'login' | 'authenticated'
  const [auth, setAuth] = useState({ status: 'checking', username: null })
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingJob, setEditingJob] = useState(null)
  const [companyFilters, setCompanyFilters] = useState([])
  const [collapsedCols, setCollapsedCols] = useState(
    () => Object.fromEntries(COLUMNS.map(c => [c.id, true]))
  )

  const companies = useMemo(
    () => [...new Set(jobs.map(j => j.company).filter(Boolean))].sort(),
    [jobs]
  )

  const visibleJobs = companyFilters.length === 0
    ? jobs
    : jobs.filter(j => companyFilters.includes(j.company))

  const checkAuth = () =>
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => setAuth({
        status: data.authenticated ? 'authenticated' : data.setup_required ? 'setup' : 'login',
        username: data.username,
      }))
      .catch(() => setAuth({ status: 'login', username: null }))

  useEffect(() => {
    checkAuth()
  }, [])

  const resetBoard = () => {
    setJobs([])
    setShowModal(false)
    setEditingJob(null)
    setCompanyFilters([])
    setLoading(true)
  }

  const apiFetch = async (url, options) => {
    const res = await fetch(url, options)
    if (res.status === 401) {
      resetBoard()
      setAuth({ status: 'login', username: null })
      throw new Error('Session expired')
    }
    return res
  }

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    apiFetch(API)
      .then(r => r.json())
      .then(data => setJobs(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [auth.status])

  const logout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {})
    resetBoard()
    setAuth({ status: 'login', username: null })
  }

  const addJob = async (formData) => {
    const res = await apiFetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })
    if (!res.ok) throw new Error('Failed to add job')
    const job = await res.json()
    setJobs(prev => [job, ...prev])
    setCollapsedCols(prev => ({ ...prev, to_be_applied: false }))
    setShowModal(false)
  }

  const moveJob = async (jobId, newStatus) => {
    const res = await apiFetch(`${API}/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    const updated = await res.json()
    setJobs(prev => prev.map(j => (j.id === jobId ? updated : j)))
  }

  const updateJob = async (jobId, formData) => {
    const res = await apiFetch(`${API}/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })
    if (!res.ok) throw new Error('Failed to update job')
    const updated = await res.json()
    setJobs(prev => prev.map(j => (j.id === jobId ? updated : j)))
    setEditingJob(null)
  }

  const deleteJob = async (jobId) => {
    await apiFetch(`${API}/${jobId}`, { method: 'DELETE' })
    setJobs(prev => prev.filter(j => j.id !== jobId))
  }

  if (auth.status === 'checking') {
    return (
      <div className={styles.app}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </div>
    )
  }

  if (auth.status !== 'authenticated') {
    return (
      <LoginPage
        key={auth.status}
        setupRequired={auth.status === 'setup'}
        onAuthenticated={username => setAuth({ status: 'authenticated', username })}
      />
    )
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              </svg>
            </span>
            <h1 className={styles.brandName}>Job Tracker</h1>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.addBtn} onClick={() => setShowModal(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Job
            </button>
            <span className={styles.divider} />
            <span className={styles.username} title={auth.username}>{auth.username}</span>
            <button className={styles.logoutBtn} onClick={logout} title="Log out" aria-label="Log out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className={styles.logoutLabel}>Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Loading jobs...</span>
          </div>
        ) : (
          <>
            <CompanyFilter
              companies={companies}
              filters={companyFilters}
              onFiltersChange={setCompanyFilters}
            />
            <KanbanBoard
              jobs={visibleJobs}
              onMove={moveJob}
              onDelete={deleteJob}
              onEdit={setEditingJob}
              forceExpanded={companyFilters.length > 0}
              collapsedCols={collapsedCols}
              setCollapsedCols={setCollapsedCols}
            />
          </>
        )}
      </main>

      {showModal && (
        <AddJobModal onClose={() => setShowModal(false)} onAdd={addJob} />
      )}
      {editingJob && (
        <AddJobModal
          job={editingJob}
          onClose={() => setEditingJob(null)}
          onSave={updateJob}
        />
      )}
    </div>
  )
}
