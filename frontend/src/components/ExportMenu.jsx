import { useState, useRef, useEffect } from 'react'
import { COLUMNS } from './KanbanBoard'
import { exportJobsCsv, exportJobsPdf } from '../lib/exportJobs'
import styles from './ExportMenu.module.css'

/**
 * Exports whatever the board is currently showing, so an active company filter
 * narrows the file the same way it narrows the columns.
 */
export default function ExportMenu({ jobs, boardTitle }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const run = (fn) => {
    setOpen(false)
    fn()
  }

  const disabled = jobs.length === 0

  return (
    <div className={styles.wrap} ref={wrapperRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title={disabled ? 'Nothing to export' : 'Export your jobs'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span className={styles.label}>Export</span>
      </button>

      {open && (
        <div className={styles.dropdown} role="menu">
          <button
            className={styles.option}
            role="menuitem"
            onClick={() => run(() => exportJobsCsv(jobs, COLUMNS))}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="16" y2="17" />
            </svg>
            <span>
              Export as CSV
              <small>Spreadsheet file</small>
            </span>
          </button>
          <button
            className={styles.option}
            role="menuitem"
            onClick={() => run(() => exportJobsPdf(jobs, COLUMNS, boardTitle))}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>
              Export as PDF
              <small>Opens the print dialog</small>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
