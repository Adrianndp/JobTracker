import { useState } from 'react'
import { Droppable } from '@hello-pangea/dnd'
import JobCard from './JobCard'
import styles from './KanbanColumn.module.css'

export default function KanbanColumn({ column, jobs, onDelete, onEdit }) {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className={`${styles.column} ${collapsed ? styles.collapsed : ''}`} style={{ '--col-color': column.color, '--col-light': column.lightColor }}>
      <button className={styles.header} onClick={() => setCollapsed(c => !c)}>
        <div className={styles.headerLeft}>
          <span className={styles.dot} />
          <h3 className={styles.title}>{column.label}</h3>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.count}>{jobs.length}</span>
          <svg
            className={`${styles.chevron} ${collapsed ? '' : styles.chevronOpen}`}
            width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`${styles.body} ${snapshot.isDraggingOver ? styles.over : ''}`}
            style={collapsed ? { padding: 0, height: 0, minHeight: 0, overflow: 'hidden', flex: 'none' } : {}}
          >
            {jobs.length === 0 && !snapshot.isDraggingOver && !collapsed && (
              <div className={styles.empty}>Drop cards here</div>
            )}
            {jobs.map((job, index) => (
              <JobCard
                key={job.id}
                job={job}
                index={index}
                color={column.color}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}
