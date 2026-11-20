import { Droppable } from '@hello-pangea/dnd'
import { ChevronDown } from 'lucide-react'
import JobCard from './JobCard'
import styles from './KanbanColumn.module.css'

export default function KanbanColumn({
  column, jobs, onDelete, onEdit, forceExpanded, collapsed, onToggle, companyIndex, onShowCompany, statusLabels,
}) {
  // Empty columns are always open; active filter forces all columns open
  const isCollapsed = !forceExpanded && collapsed && jobs.length > 0
  const cards = jobs.map((job, index) => (
    <JobCard
      key={job.id}
      job={job}
      index={index}
      color={column.color}
      onDelete={onDelete}
      onEdit={onEdit}
      companyGroup={companyIndex?.byName.get(job.company?.trim())}
      onShowCompany={onShowCompany}
      statusLabels={statusLabels}
    />
  ))

  const StatusIcon = column.icon

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
        <StatusIcon className={styles.statusIcon} size={15} strokeWidth={2.25} />
        <h3 className={styles.title}>{column.label}</h3>
        <span className={styles.count}>{jobs.length}</span>
        {jobs.length > 0 && (
          <ChevronDown className={`${styles.chevron} ${isCollapsed ? styles.chevronCollapsed : ''}`} size={14} />
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
