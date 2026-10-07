import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Download, FileSpreadsheet, Printer } from 'lucide-react'
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
        <Download size={16} />
        <span className={styles.label}>Export</span>
        <ChevronDown className={styles.caret} size={14} />
      </button>

      {open && (
        <div className={styles.dropdown} role="menu">
          <button
            className={styles.option}
            role="menuitem"
            onClick={() => run(() => exportJobsCsv(jobs, COLUMNS))}
          >
            <FileSpreadsheet size={16} />
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
            <Printer size={16} />
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
