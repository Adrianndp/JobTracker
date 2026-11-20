import { Draggable } from '@hello-pangea/dnd'
import { ArrowUpRight, Building2, CalendarDays, History, MessagesSquare, Pencil, Trash2 } from 'lucide-react'
import { safeHref } from '../lib/safeUrl'
import styles from './JobCard.module.css'

const formatDate = (iso) => {
  if (!iso) return null
  const date = new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric' })
  const time = new Date(iso).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

export default function JobCard({ job, index, color, onDelete, onEdit, companyGroup, onShowCompany, statusLabels = {} }) {
  // null when job.link isn't an http(s) URL (legacy notes, or anything scraped)
  const href = safeHref(job.link)
  // Other jobs at the same company, however it was spelled (lib/companyMatch)
  const siblings = companyGroup ? companyGroup.jobs.filter(j => j.id !== job.id) : []
  // The case worth a warning: about to apply somewhere you already did
  const appliedBefore = job.status === 'to_be_applied' && siblings.some(j => j.status !== 'to_be_applied')
  const siblingSummary = siblings
    .map(j => `${j.name} (${statusLabels[j.status] ?? j.status})${j.company !== job.company ? ` at ${j.company}` : ''}`)
    .join('\n')
  const handleDelete = (e) => {
    e.stopPropagation()
    if (window.confirm(`Remove "${job.name}"?`)) {
      onDelete(job.id)
    }
  }

  const handleEdit = (e) => {
    e.stopPropagation()
    onEdit(job)
  }

  const handleShowCompany = (e) => {
    e.stopPropagation()
    onShowCompany?.(companyGroup.name)
  }

  return (
    <Draggable draggableId={String(job.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`${styles.card} ${snapshot.isDragging ? styles.dragging : ''}`}
          style={{
            ...provided.draggableProps.style,
            '--col-color': color,
          }}
        >
          <div className={styles.content}>
            <div className={styles.top}>
              <div className={styles.titleGroup}>
                <p className={styles.name}>{job.name}</p>
                {job.company && <p className={styles.company}>{job.company}</p>}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={handleEdit}
                  title="Edit"
                  aria-label="Edit job"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={handleDelete}
                  title="Remove"
                  aria-label="Remove job"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {(job.applied_date || job.salary) && (
              <div className={styles.metaRow}>
                {job.applied_date && (
                  <span className={styles.appliedDate}>
                    <CalendarDays size={12} />
                    {formatDate(job.applied_date)}
                  </span>
                )}
                {job.salary && <span className={styles.salary}>{job.salary}</span>}
              </div>
            )}

            {(job.link || job.had_interview || siblings.length > 0) && (
              <div className={styles.footerRow}>
                {job.link && !href && (
                  <span className={styles.linkPlain}>{job.link}</span>
                )}
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.link}
                    onClick={e => e.stopPropagation()}
                  >
                    View posting
                    <ArrowUpRight size={12} />
                  </a>
                )}
                <span className={styles.badges}>
                  {job.had_interview && (
                    <span className={styles.interviewBadge}>
                      <MessagesSquare size={12} />
                      {job.status === 'in_interview' ? 'Interviewing' : 'Interviewed'}
                    </span>
                  )}
                  {siblings.length > 0 && (
                    <button
                      type="button"
                      className={appliedBefore ? styles.appliedBeforeBadge : styles.companyBadge}
                      onClick={handleShowCompany}
                      title={`Also at this company:\n${siblingSummary}\n\nClick to show them all`}
                      aria-label={`${siblings.length} other ${siblings.length === 1 ? 'job' : 'jobs'} at ${companyGroup.name}`
                        + `${appliedBefore ? ', already applied there' : ''}. Show all jobs at this company`}
                    >
                      {appliedBefore ? <History size={12} /> : <Building2 size={12} />}
                      {appliedBefore ? 'Applied here before' : `+${siblings.length} here`}
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  )
}
