import { useState, useRef, useEffect } from 'react'
import { Building2, Search, X } from 'lucide-react'
import styles from './CompanyFilter.module.css'

/**
 * groups come from lib/companyMatch indexCompanies: one entry per company, with
 * every spelling it was saved under, so "Siemens" also finds "Siemens AG".
 */
export default function CompanyFilter({ groups, filters, onFiltersChange }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  const query = input.trim().toLowerCase()
  const suggestions = groups.filter(
    g => !filters.includes(g.name) && g.variants.some(v => v.toLowerCase().includes(query))
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
      add(suggestions[0].name)
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
              {suggestions.map(g => (
                <button
                  key={g.id}
                  className={styles.option}
                  onMouseDown={() => add(g.name)}
                  title={g.variants.length > 1 ? `Saved as: ${g.variants.join(', ')}` : undefined}
                >
                  <Building2 size={14} />
                  <span className={styles.optionText}>
                    <span className={styles.optionName}>{g.name}</span>
                    {g.variants.length > 1 && (
                      <span className={styles.optionAlso}>also {g.variants.slice(1).join(', ')}</span>
                    )}
                  </span>
                  <span className={styles.optionCount}>{g.jobs.length}</span>
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
