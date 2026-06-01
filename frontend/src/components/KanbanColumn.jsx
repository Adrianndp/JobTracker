import { Droppable } from '@hello-pangea/dnd'
import JobCard from './JobCard'
import styles from './KanbanColumn.module.css'

export default function KanbanColumn({ column, jobs, onDelete, onEdit }) {
  return (
    <div className={styles.column} style={{ '--col-color': column.color, '--col-light': column.lightColor }}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.dot} />
          <h3 className={styles.title}>{column.label}</h3>
        </div>
        <span className={styles.count}>{jobs.length}</span>
      </div>

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`${styles.body} ${snapshot.isDraggingOver ? styles.over : ''}`}
          >
            {jobs.length === 0 && !snapshot.isDraggingOver && (
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
