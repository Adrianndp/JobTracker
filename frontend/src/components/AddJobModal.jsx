import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { ApiError } from '../api'
import CompanyMatches from './CompanyMatches'
import styles from './AddJobModal.module.css'

export default function AddJobModal({ onClose, onAdd, onSave, onUpgrade, job, jobs = [] }) {
  const isEdit = Boolean(job)
  const [form, setForm] = useState({
    name: job?.name ?? '',
    company: job?.company ?? '',
    link: job?.link ?? '',
    salary: job?.salary ?? '',
    had_interview: job?.had_interview ?? false,
  })
  const [error, setError] = useState('')
  const [limitHit, setLimitHit] = useState(false)
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
    } catch (err) {
      // The server's message for anything it rejected (free limit, bad link, ...)
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setLimitHit(err instanceof ApiError && err.code === 'plan_limit')
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="job-modal-title" className={styles.modalTitle}>{isEdit ? 'Edit job' : 'Add a job'}</h2>
            <p className={styles.modalSubtitle}>
              {isEdit ? 'Update the details of this application.' : 'It goes into To Be Applied.'}
            </p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-name">Job title</label>
            <input
              id="job-name"
              ref={firstInput}
              type="text"
              className={styles.input}
              placeholder="e.g. Senior Frontend Engineer"
              value={form.name}
              onChange={set('name')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-company">Company</label>
            <input
              id="job-company"
              type="text"
              className={styles.input}
              placeholder="e.g. Stripe"
              value={form.company}
              onChange={set('company')}
            />
            <CompanyMatches
              company={form.company}
              jobs={jobs}
              exceptId={job?.id}
              onUseSpelling={(company) => setForm(f => ({ ...f, company }))}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-link">
              Posting URL <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="job-link"
              type="url"
              className={styles.input}
              placeholder="https://company.com/jobs/..."
              value={form.link}
              onChange={set('link')}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-salary">
              Salary <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="job-salary"
              type="text"
              className={styles.input}
              placeholder="e.g. €60,000 – €80,000 / year"
              value={form.salary}
              onChange={set('salary')}
            />
          </div>

          {isEdit && (
            <button
              type="button"
              role="switch"
              aria-checked={form.had_interview}
              className={`${styles.toggleBtn} ${form.had_interview ? styles.toggleBtnOn : ''}`}
              onClick={toggle('had_interview')}
            >
              <span className={styles.toggleTrack}>
                <span className={styles.toggleThumb} />
              </span>
              Had an interview
            </button>
          )}

          {error && (
            <p className={styles.error} role="alert">
              {error}
              {limitHit && onUpgrade && (
                <>
                  {' '}
                  <button type="button" className={styles.errorLink} onClick={onUpgrade}>See plans</button>
                </>
              )}
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading && <span className={styles.btnSpinner} />}
              {isEdit
                ? (loading ? 'Saving…' : 'Save changes')
                : (loading ? 'Adding…' : 'Add job')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
