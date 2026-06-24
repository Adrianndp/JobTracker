import { useState, useRef, useEffect } from 'react'
import styles from './CompanyFilter.module.css'

export default function CompanyFilter({ companies, filters, onFiltersChange }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  const suggestions = companies.filter(
    c => !filters.includes(c) && c.toLowerCase().includes(input.toLowerCase())
  )

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const add = (company) => {
    onFiltersChange([...filters, company])
    setInput('')
    setOpen(false)
  }

  const remove = (company) => {
    onFiltersChange(filters.filter(f => f !== company))
  }

  const handleInputChange = (e) => {
    setInput(e.target.value)
    setOpen(true)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && suggestions.length === 1) {
      add(suggestions[0])
    }
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.bar}>
      <svg className={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <div className={styles.inner}>
        {filters.map(f => (
          <span key={f} className={styles.chip}>
            {f}
            <button className={styles.chipX} onClick={() => remove(f)} aria-label={`Remove ${f} filter`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}

        <div className={styles.inputWrap} ref={wrapperRef}>
          <input
            className={styles.input}
            placeholder={filters.length === 0 ? 'Filter by company…' : 'Add another…'}
            value={input}
            onChange={handleInputChange}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
          />
          {open && suggestions.length > 0 && (
            <div className={styles.dropdown}>
              {suggestions.map(s => (
                <button key={s} className={styles.option} onMouseDown={() => add(s)}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" />
                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  </svg>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {filters.length > 0 && (
        <button className={styles.clearAll} onClick={() => onFiltersChange([])}>
          Clear all
        </button>
      )}
    </div>
  )
}
