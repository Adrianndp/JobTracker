import { useState } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import { Bookmark, CircleX, Ghost, MessagesSquare, Send, Trophy } from 'lucide-react'
import KanbanColumn from './KanbanColumn'
import styles from './KanbanBoard.module.css'

export const COLUMNS = [
  {
    id: 'to_be_applied',
    label: 'To Be Applied',
    color: '#6366f1',
    icon: Bookmark,
  },
  {
    id: 'applied',
    label: 'Applied',
    color: '#f59e0b',
    icon: Send,
  },
  {
    id: 'in_interview',
    label: 'In Interview',
    color: '#8b5cf6',
    icon: MessagesSquare,
  },
  {
    id: 'ghosted',
    label: 'Ghosted',
    color: '#64748b',
    icon: Ghost,
  },
  {
    id: 'rejected',
    label: 'Got Rejected',
    color: '#ef4444',
    icon: CircleX,
  },
  {
    id: 'offer',
    label: 'Got an Offer',
    color: '#10b981',
    icon: Trophy,
  },
]

export default function KanbanBoard({ jobs, onMove, onDelete, onEdit, forceExpanded, collapsedCols, setCollapsedCols }) {
  const handleDragEnd = ({ draggableId, destination }) => {
    if (!destination) return
    onMove(parseInt(draggableId), destination.droppableId)
    setCollapsedCols(prev => ({ ...prev, [destination.droppableId]: false }))
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
            forceExpanded={forceExpanded}
            collapsed={collapsedCols[col.id]}
            onToggle={() => setCollapsedCols(prev => ({ ...prev, [col.id]: !prev[col.id] }))}
          />
        ))}
      </div>
    </DragDropContext>
  )
}
