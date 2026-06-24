import { useState, useEffect, useMemo } from 'react'
import KanbanBoard, { COLUMNS } from './components/KanbanBoard'
import AddJobModal from './components/AddJobModal'
import CompanyFilter from './components/CompanyFilter'
import styles from './App.module.css'

const API = '/api/jobs'

export default function App() {
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

  useEffect(() => {
    fetch(API)
      .then(r => r.json())
      .then(data => setJobs(data))
      .finally(() => setLoading(false))
  }, [])

  const addJob = async (formData) => {
    const res = await fetch(API, {
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
    const res = await fetch(`${API}/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    const updated = await res.json()
    setJobs(prev => prev.map(j => (j.id === jobId ? updated : j)))
  }

  const updateJob = async (jobId, formData) => {
    const res = await fetch(`${API}/${jobId}`, {
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
    await fetch(`${API}/${jobId}`, { method: 'DELETE' })
    setJobs(prev => prev.filter(j => j.id !== jobId))
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
          <button className={styles.addBtn} onClick={() => setShowModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Job
          </button>
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
