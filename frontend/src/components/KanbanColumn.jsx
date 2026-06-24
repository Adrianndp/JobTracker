import { Droppable } from '@hello-pangea/dnd'
import JobCard from './JobCard'
import styles from './KanbanColumn.module.css'

export default function KanbanColumn({ column, jobs, onDelete, onEdit, forceExpanded, collapsed, onToggle }) {
  // Empty columns are always open; active filter forces all columns open
  const isCollapsed = !forceExpanded && collapsed && jobs.length > 0

  return (
    <div className={styles.column} style={{ '--col-color': column.color, '--col-light': column.lightColor }}>
      <button
        className={styles.header}
        onClick={() => jobs.length > 0 && onToggle()}
        style={jobs.length === 0 ? { cursor: 'default' } : {}}
      >
        <div className={styles.headerLeft}>
          <span className={styles.dot} />
          <h3 className={styles.title}>{column.label}</h3>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.count}>{jobs.length}</span>
          {jobs.length > 0 && (
            <svg
              className={`${styles.chevron} ${isCollapsed ? '' : styles.chevronOpen}`}
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </div>
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
                <div className={`${styles.empty} ${snapshot.isDraggingOver ? styles.emptyDragOver : ''}`}>
                  Drop cards here
                </div>
                {/* Cards stay mounted so DnD can track them */}
                <div style={{ height: 0, overflow: 'hidden' }}>
                  {jobs.map((job, index) => (
                    <JobCard key={job.id} job={job} index={index} color={column.color} onDelete={onDelete} onEdit={onEdit} />
                  ))}
                </div>
              </>
            ) : (
              <>
                {jobs.length === 0 && !snapshot.isDraggingOver && (
                  <div className={styles.empty}>Drop cards here</div>
                )}
                {jobs.map((job, index) => (
                  <JobCard key={job.id} job={job} index={index} color={column.color} onDelete={onDelete} onEdit={onEdit} />
                ))}
              </>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}
