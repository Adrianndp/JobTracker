import { useState, useMemo } from 'react'
import KanbanBoard, { COLUMNS } from './components/KanbanBoard'
import AddJobModal from './components/AddJobModal'
import CompanyFilter from './components/CompanyFilter'
import LoginPage from './components/LoginPage'
import {
  useAuthStatus, useLogout, useUnauthorized,
  useJobs, useCreateJob, useUpdateJob, useDeleteJob,
} from './api'
import styles from './App.module.css'

export default function App() {
  const authStatus = useAuthStatus()
  // Set once the user logs in or out in this tab; until then the server's status decides
  const [session, setSession] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingJob, setEditingJob] = useState(null)
  const [companyFilters, setCompanyFilters] = useState([])
  const [collapsedCols, setCollapsedCols] = useState(
    () => Object.fromEntries(COLUMNS.map(c => [c.id, true]))
  )

  // status: 'checking' | 'setup' | 'login' | 'authenticated'
  const auth = session ?? (
    authStatus.loading ? { status: 'checking', username: null }
      : authStatus.data?.authenticated ? { status: 'authenticated', username: authStatus.data.username }
      : authStatus.data?.setup_required ? { status: 'setup', username: null }
      : { status: 'login', username: null }
  )

  const { jobs, setJobs, loading } = useJobs(auth.status === 'authenticated')
  const { logout } = useLogout()
  const { createJob } = useCreateJob()
  const { updateJob } = useUpdateJob()
  const { deleteJob } = useDeleteJob()

  const companies = useMemo(
    () => [...new Set(jobs.map(j => j.company).filter(Boolean))].sort(),
    [jobs]
  )

  const visibleJobs = companyFilters.length === 0
    ? jobs
    : jobs.filter(j => companyFilters.includes(j.company))

  const signOut = () => {
    setShowModal(false)
    setEditingJob(null)
    setCompanyFilters([])
    setSession({ status: 'login', username: null })
  }

  useUnauthorized(signOut)

  const handleLogout = async () => {
    await logout().catch(() => {})
    signOut()
  }

  const addJob = async (formData) => {
    const job = await createJob(formData)
    setJobs(prev => [job, ...prev])
    setCollapsedCols(prev => ({ ...prev, to_be_applied: false }))
    setShowModal(false)
  }

  const moveJob = async (jobId, newStatus) => {
    try {
      const updated = await updateJob(jobId, { status: newStatus })
      setJobs(prev => prev.map(j => (j.id === jobId ? updated : j)))
    } catch {
      // expired sessions are handled by useUnauthorized
    }
  }

  const saveJob = async (jobId, formData) => {
    const updated = await updateJob(jobId, formData)
    setJobs(prev => prev.map(j => (j.id === jobId ? updated : j)))
    setEditingJob(null)
  }

  const toggleAllColumns = () => {
    const nonEmptyCols = COLUMNS.filter(col => visibleJobs.some(j => j.status === col.id))
    const allExpanded = nonEmptyCols.length > 0 && nonEmptyCols.every(col => collapsedCols[col.id] === false)
    setCollapsedCols(Object.fromEntries(COLUMNS.map(c => [c.id, allExpanded])))
  }

  const removeJob = async (jobId) => {
    try {
      await deleteJob(jobId)
      setJobs(prev => prev.filter(j => j.id !== jobId))
    } catch {
      // expired sessions are handled by useUnauthorized
    }
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
        onAuthenticated={username => setSession({ status: 'authenticated', username })}
      />
    )
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <button
            className={styles.brand}
            onClick={toggleAllColumns}
            title="Expand or collapse all columns"
          >
            <span className={styles.brandIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              </svg>
            </span>
            <h1 className={styles.brandName}>Job Tracker</h1>
          </button>
          <span className={styles.boardTitle}>{auth.username}'s Job Board</span>
          <div className={styles.headerActions}>
            <button className={styles.logoutBtn} onClick={handleLogout} title="Log out" aria-label="Log out">
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
            <div className={styles.filterRow}>
              <CompanyFilter
                companies={companies}
                filters={companyFilters}
                onFiltersChange={setCompanyFilters}
              />
              <button className={styles.addBtn} onClick={() => setShowModal(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Job
              </button>
            </div>
            <KanbanBoard
              jobs={visibleJobs}
              onMove={moveJob}
              onDelete={removeJob}
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
          onSave={saveJob}
        />
      )}
    </div>
  )
}
