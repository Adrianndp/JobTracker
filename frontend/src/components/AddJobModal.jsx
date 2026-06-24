import { useState, useEffect, useRef } from 'react'
import styles from './AddJobModal.module.css'

export default function AddJobModal({ onClose, onAdd, onSave, job }) {
  const isEdit = Boolean(job)
  const [form, setForm] = useState({
    name: job?.name ?? '',
    company: job?.company ?? '',
    link: job?.link ?? '',
    salary: job?.salary ?? '',
    had_interview: job?.had_interview ?? false,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const firstInput = useRef(null)

  useEffect(() => {
    firstInput.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))
  const toggle = (field) => () => setForm(f => ({ ...f, [field]: !f[field] }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Job title is required.')
      return
    }
    if (!form.company.trim()) {
      setError('Company is required.')
      return
    }
    setError('')
    setLoading(true)
    try {
      isEdit ? await onSave(job.id, form) : await onAdd(form)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <div className={styles.modalIcon} style={isEdit ? { background: '#fef3c7', color: '#d97706' } : {}}>
              {isEdit ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                </svg>
              )}
            </div>
            <h2>{isEdit ? 'Edit Job' : 'Add New Job'}</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.field}>
            <label className={styles.label}>
              Job Title
              <span className={styles.required}>*</span>
            </label>
            <input
              ref={firstInput}
              type="text"
              className={styles.input}
              placeholder="e.g. Senior Frontend Engineer"
              value={form.name}
              onChange={set('name')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              Company
              <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. Stripe"
              value={form.company}
              onChange={set('company')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Job URL</label>
            <input
              type="url"
              className={styles.input}
              placeholder="https://company.com/jobs/..."
              value={form.link}
              onChange={set('link')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              Salary
              <span className={styles.optional}>optional</span>
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. €60,000 – €80,000 / year"
              value={form.salary}
              onChange={set('salary')}
            />
          </div>

          {isEdit && (
            <div className={styles.field}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${form.had_interview ? styles.toggleBtnOn : ''}`}
                onClick={toggle('had_interview')}
              >
                <span className={styles.toggleTrack}>
                  <span className={styles.toggleThumb} />
                </span>
                Had an interview
              </button>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.submitBtn} ${isEdit ? styles.submitBtnEdit : ''}`} disabled={loading}>
              {loading ? (
                <>
                  <span className={styles.btnSpinner} />
                  {isEdit ? 'Saving...' : 'Adding...'}
                </>
              ) : isEdit ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Save Changes
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add to Board
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
