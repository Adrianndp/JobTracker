import { useMemo } from 'react'
import { Building2, History } from 'lucide-react'
import { COLUMNS } from './KanbanBoard'
import { jobsAtCompany, usualSpelling } from '../lib/companyMatch'
import styles from './CompanyMatches.module.css'

const SHOWN = 3

// Most telling first: where you got furthest, then the latest application
const STAGE = { offer: 0, in_interview: 1, rejected: 2, ghosted: 3, applied: 4, to_be_applied: 5 }
const byRelevance = (a, b) => (STAGE[a.status] ?? 9) - (STAGE[b.status] ?? 9)
  || (b.applied_date ?? b.created_at ?? '').localeCompare(a.applied_date ?? a.created_at ?? '')

const shortDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : null)

/**
 * Shown under a Company field: the jobs already on the board at the same (or a
 * similarly spelled) company, so a second application there is a conscious one.
 * Offers the spelling already in use, so the board doesn't collect variants.
 */
export default function CompanyMatches({ company, jobs, exceptId, onUseSpelling }) {
  const matches = useMemo(
    () => jobsAtCompany(company, jobs, exceptId).sort(byRelevance),
    [company, jobs, exceptId]
  )
  if (!matches.length) return null

  const spelling = usualSpelling(matches)
  const applied = matches.some(j => j.status !== 'to_be_applied')
  const Icon = applied ? History : Building2
  const count = matches.length === 1 ? '1 job' : `${matches.length} jobs`

  return (
    <div className={applied ? styles.warning : styles.info} role="status">
      <p className={styles.title}>
        <Icon size={14} />
        <span>
          {applied ? 'You already applied at ' : 'Already on your board: '}
          <strong>{spelling}</strong> ({count})
        </span>
      </p>
      <ul className={styles.list}>
        {matches.slice(0, SHOWN).map(job => {
          const col = COLUMNS.find(c => c.id === job.status) ?? COLUMNS[0]
          const date = job.status !== 'to_be_applied' && shortDate(job.applied_date)
          return (
            <li key={job.id} className={styles.item} style={{ '--col-color': col.color }}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.jobName}>{job.name}</span>
              <span className={styles.meta}>{col.label}{date && ` · ${date}`}</span>
            </li>
          )
        })}
      </ul>
      {matches.length > SHOWN && <p className={styles.more}>and {matches.length - SHOWN} more</p>}
      {onUseSpelling && spelling && spelling !== company.trim() && (
        <button type="button" className={styles.useBtn} onClick={() => onUseSpelling(spelling)}>
          Use &ldquo;{spelling}&rdquo;
        </button>
      )}
    </div>
  )
}
