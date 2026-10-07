import { useState, useRef, useEffect } from 'react'
import { Building2, Search, X } from 'lucide-react'
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
      <Search className={styles.searchIcon} size={16} />

      <div className={styles.inner}>
        {filters.map(f => (
          <span key={f} className={styles.chip}>
            {f}
            <button className={styles.chipX} onClick={() => remove(f)} aria-label={`Remove ${f} filter`}>
              <X size={12} strokeWidth={2.5} />
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
                  <Building2 size={14} />
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
