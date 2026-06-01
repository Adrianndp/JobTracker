import { DragDropContext } from '@hello-pangea/dnd'
import KanbanColumn from './KanbanColumn'
import styles from './KanbanBoard.module.css'

export const COLUMNS = [
  {
    id: 'to_be_applied',
    label: 'To Be Applied',
    color: '#6366f1',
    lightColor: '#eef2ff',
    emoji: null,
  },
  {
    id: 'applied',
    label: 'Applied',
    color: '#f59e0b',
    lightColor: '#fffbeb',
    emoji: null,
  },
  {
    id: 'in_interview',
    label: 'In Interview Process',
    color: '#8b5cf6',
    lightColor: '#f5f3ff',
    emoji: null,
  },
  {
    id: 'rejected',
    label: 'Got Rejected',
    color: '#ef4444',
    lightColor: '#fef2f2',
    emoji: null,
  },
  {
    id: 'offer',
    label: 'Got an Offer',
    color: '#10b981',
    lightColor: '#ecfdf5',
    emoji: null,
  },
]

export default function KanbanBoard({ jobs, onMove, onDelete, onEdit }) {
  const handleDragEnd = ({ draggableId, destination }) => {
    if (!destination) return
    onMove(parseInt(draggableId), destination.droppableId)
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className={styles.board}>
        {COLUMNS.map(col => (
          <KanbanColumn
            key={col.id}
            column={col}
            jobs={jobs.filter(j => j.status === col.id)}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
      </div>
    </DragDropContext>
  )
}
