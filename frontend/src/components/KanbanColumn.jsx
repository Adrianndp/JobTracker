import { Droppable } from '@hello-pangea/dnd'
import JobCard from './JobCard'
import styles from './KanbanColumn.module.css'

export default function KanbanColumn({ column, jobs, onDelete, onEdit, forceExpanded, collapsed, onToggle }) {
  // Empty columns are always open; active filter forces all columns open
  const isCollapsed = !forceExpanded && collapsed && jobs.length > 0
  const cards = jobs.map((job, index) => (
    <JobCard key={job.id} job={job} index={index} color={column.color} onDelete={onDelete} onEdit={onEdit} />
  ))

  return (
    <section className={styles.column} style={{ '--col-color': column.color }} aria-label={column.label}>
      <button
        type="button"
        className={styles.header}
        onClick={onToggle}
        disabled={jobs.length === 0}
        aria-expanded={!isCollapsed}
        title={isCollapsed ? 'Show cards' : 'Hide cards'}
      >
        <span className={styles.dot} />
        <h3 className={styles.title}>{column.label}</h3>
        <span className={styles.count}>{jobs.length}</span>
        {jobs.length > 0 && (
          <svg
            className={`${styles.chevron} ${isCollapsed ? '' : styles.chevronOpen}`}
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`${styles.body} ${snapshot.isDraggingOver ? styles.over : ''}`}
          >
            {isCollapsed ? (
              <>
                <button type="button" className={styles.hidden} onClick={onToggle}>
                  {jobs.length} hidden · Show
                </button>
                {/* Cards stay mounted so DnD can track them */}
                <div className={styles.collapsedCards}>{cards}</div>
              </>
            ) : (
              <>
                {jobs.length === 0 && !snapshot.isDraggingOver && (
                  <div className={styles.empty}>Drag a card here</div>
                )}
                {cards}
              </>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </section>
  )
}
