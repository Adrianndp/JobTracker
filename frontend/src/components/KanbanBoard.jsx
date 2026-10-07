import { useState } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import KanbanColumn from './KanbanColumn'
import styles from './KanbanBoard.module.css'

export const COLUMNS = [
  {
    id: 'to_be_applied',
    label: 'To Be Applied',
    color: '#6366f1',
    emoji: null,
  },
  {
    id: 'applied',
    label: 'Applied',
    color: '#f59e0b',
    emoji: null,
  },
  {
    id: 'in_interview',
    label: 'In Interview',
    color: '#8b5cf6',
    emoji: null,
  },
  {
    id: 'ghosted',
    label: 'Ghosted',
    color: '#64748b',
    emoji: null,
  },
  {
    id: 'rejected',
    label: 'Got Rejected',
    color: '#ef4444',
    emoji: null,
  },
  {
    id: 'offer',
    label: 'Got an Offer',
    color: '#10b981',
    emoji: null,
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
