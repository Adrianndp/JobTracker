import { Draggable } from '@hello-pangea/dnd'
import styles from './JobCard.module.css'

const formatDate = (iso) => {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function JobCard({ job, index, color, onDelete, onEdit }) {
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
            '--accent': color,
          }}
        >
          <div className={styles.accent} />
          <div className={styles.content}>
            <div className={styles.top}>
              <div className={styles.titleGroup}>
                <p className={styles.name}>{job.name}</p>
                {job.company && <p className={styles.company}>{job.company}</p>}
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.editBtn}
                  onClick={handleEdit}
                  title="Edit"
                  aria-label="Edit job"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={handleDelete}
                  title="Remove"
                  aria-label="Remove job"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {job.link && (
              <a
                href={job.link}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
                onClick={e => e.stopPropagation()}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                View posting
              </a>
            )}

            {job.applied_date && (
              <div className={styles.appliedDate}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Applied {formatDate(job.applied_date)}
              </div>
            )}

            <div className={styles.meta}>
              {job.salary && (
                <div className={styles.salary}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  {job.salary}
                </div>
              )}
              {job.had_interview && (
                <div className={styles.interviewBadge}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  Interviewed
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}
