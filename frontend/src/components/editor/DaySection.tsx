import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useItineraryStore } from '../../stores/itineraryStore'
import { useDirtyStore } from '../../stores/dirtyStore'
import { useUIStore } from '../../stores/uiStore'
import EditableCell from './EditableCell'
import type { DayWithItems, Item } from '../../types'

const TRANSPORT_OPTIONS = ['walking', 'subway', 'taxi', 'flight', 'bus', 'other']
const BOOKING_STATUS_OPTIONS = ['not_booked', 'pending', 'booked']

interface SortableRowProps {
  item: Item
  itineraryId: string
  baseTimestamps: Record<string, Record<string, string>>
  columnVisibility: Record<string, boolean>
  readOnly: boolean
  onDelete: (itemId: string) => void
  /** If set, render the date cell with this rowSpan */
  dateCell?: React.ReactNode
  dateCellRowSpan?: number
}

function SortableRow({ item, itineraryId, baseTimestamps, columnVisibility, readOnly, onDelete, dateCell, dateCellRowSpan }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }

  const ts = baseTimestamps[item.id] ?? {}

  return (
    <tr ref={setNodeRef} style={style} className="border-b border-gray-200 hover:bg-gray-50">
      {dateCell !== undefined && (
        <td
          className="border-r border-gray-200 bg-gray-50 align-top px-2 py-1"
          rowSpan={dateCellRowSpan}
        >
          {dateCell}
        </td>
      )}
      {!readOnly && (
        <td className="px-1 text-gray-300 cursor-grab" data-tour="drag-handle" {...attributes} {...listeners}>&#x2807;</td>
      )}
      {columnVisibility['time_start'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="time_start"
            value={item.time_start} basedOnUpdatedAt={ts['time_start'] ?? ''} readOnly={readOnly}
          />
        </td>
      )}
      {columnVisibility['time_end'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="time_end"
            value={item.time_end} basedOnUpdatedAt={ts['time_end'] ?? ''} readOnly={readOnly}
          />
        </td>
      )}
      {columnVisibility['spot_name'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="spot_name"
            value={item.spot_name} basedOnUpdatedAt={ts['spot_name'] ?? ''} readOnly={readOnly}
          />
        </td>
      )}
      {columnVisibility['activity_desc'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="activity_desc"
            value={item.activity_desc} basedOnUpdatedAt={ts['activity_desc'] ?? ''} readOnly={readOnly}
          />
        </td>
      )}
      {columnVisibility['transport'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="transport"
            value={item.transport} basedOnUpdatedAt={ts['transport'] ?? ''}
            type="select" options={TRANSPORT_OPTIONS} readOnly={readOnly}
          />
        </td>
      )}
      {columnVisibility['estimated_cost'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="estimated_cost"
            value={item.estimated_cost} basedOnUpdatedAt={ts['estimated_cost'] ?? ''}
            type="number" readOnly={readOnly}
          />
        </td>
      )}
      {columnVisibility['booking_status'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="booking_status"
            value={item.booking_status} basedOnUpdatedAt={ts['booking_status'] ?? ''}
            type="select" options={BOOKING_STATUS_OPTIONS} readOnly={readOnly}
          />
        </td>
      )}
      {columnVisibility['notes'] && (
        <td className="overflow-hidden">
          <EditableCell
            itineraryId={itineraryId} itemId={item.id} field="notes"
            value={item.notes} basedOnUpdatedAt={ts['notes'] ?? ''} readOnly={readOnly}
          />
        </td>
      )}
      {!readOnly && (
        <td className="text-center">
          <button
            onClick={() => onDelete(item.id)}
            className="text-gray-300 hover:text-red-500 text-sm"
            title="Delete activity"
          >
            &#10005;
          </button>
        </td>
      )}
    </tr>
  )
}

function EmptyDayDropZone({ dayId, totalCols, dateCellContent, readOnly }: { dayId: string; totalCols: number; dateCellContent: React.ReactNode; readOnly: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `empty-day:${dayId}`, disabled: readOnly })
  return (
    <tbody ref={setNodeRef}>
      <tr className={`border-b border-gray-200 ${isOver ? 'bg-indigo-50' : ''}`}>
        <td className="border-r border-gray-200 bg-gray-50 px-2 py-2 w-32">{dateCellContent}</td>
        <td colSpan={totalCols} className="px-3 py-2 text-xs text-gray-400 italic">
          {isOver ? 'Drop here' : 'No activities yet'}
        </td>
      </tr>
    </tbody>
  )
}

interface DaySectionProps {
  day: DayWithItems
  itineraryId: string
  readOnly?: boolean
}

export default function DaySection({ day, itineraryId, readOnly = false }: DaySectionProps) {
  const { baseTimestamps, addItem, removeItem, removeDay, updateDay } = useItineraryStore()
  const { pushUndo, markDeleteItem, markDeleteDay, markDayUpdate } = useDirtyStore()
  const { columnVisibility } = useUIStore()
  const [collapsed, setCollapsed] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [dateValue, setDateValue] = useState(day.date)

  const handleAddItem = () => {
    const now = new Date().toISOString()
    const tempItem: Item = {
      id: `temp-${crypto.randomUUID()}`,
      day_id: day.id,
      item_order: day.items.length,
      time_start: null, time_end: null, spot_name: null, activity_desc: null,
      transport: null, estimated_cost: null, booking_status: null, booking_url: null,
      notes: null, rating: null, last_modified_by: null,
      time_updated_at: now, spot_updated_at: now, activity_updated_at: now,
      transport_updated_at: now, cost_updated_at: now, booking_status_updated_at: now,
      booking_url_updated_at: now, notes_updated_at: now, rating_updated_at: now,
    }
    addItem(day.id, tempItem)
  }

  const handleDeleteItem = (itemId: string) => {
    if (!confirm('Delete this activity?')) return
    pushUndo()
    removeItem(itemId)
    if (itemId.startsWith('temp-')) {
      useDirtyStore.getState().clearItem(itemId)
    } else {
      markDeleteItem(itineraryId, itemId)
    }
  }

  const handleDeleteDay = () => {
    if (!confirm(`Delete ${day.date} and all its activities?`)) return
    pushUndo()
    markDeleteDay(itineraryId, day.id)
    removeDay(day.id)
  }

  const handleDateSave = () => {
    setEditingDate(false)
    if (dateValue === day.date) return
    // Check if another day already has this date
    const allDays = useItineraryStore.getState().itinerary?.days ?? []
    if (allDays.some((d) => d.id !== day.id && d.date === dateValue)) {
      useUIStore.getState().addToast(`${dateValue} already exists`, 'warning')
      setDateValue(day.date)
      return
    }
    pushUndo()
    markDayUpdate(itineraryId, day.id, { date: dateValue })
    updateDay(day.id, { date: dateValue })
  }

  // Count visible columns for the collapsed row's colSpan
  const visibleCols = ['time_start', 'time_end', 'spot_name', 'activity_desc', 'transport', 'estimated_cost', 'booking_status', 'notes']
    .filter((c) => columnVisibility[c]).length
  const totalCols = visibleCols + (readOnly ? 0 : 2) // +drag +delete columns

  // Format date: "2026-04-05" → "26/04/05"
  const shortDate = (d: string) => {
    const [y, m, dd] = d.split('-')
    return `${y.slice(2)}/${m}/${dd}`
  }

  // Date cell content (shown on first row, spans all item rows)
  const dateCellContent = (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-400 hover:text-gray-600 text-xs leading-none"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '\u25B6' : '\u25BC'}
        </button>
        {!readOnly && editingDate ? (
          <input
            type="date"
            autoFocus
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            onBlur={handleDateSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleDateSave(); if (e.key === 'Escape') { setEditingDate(false); setDateValue(day.date) } }}
            className="text-xs font-semibold text-gray-700 border rounded px-0.5 w-[105px]"
          />
        ) : (
          <span
            className={`text-xs font-semibold text-gray-700 ${!readOnly ? 'cursor-pointer hover:text-indigo-600' : ''}`}
            onClick={() => { if (!readOnly) { setEditingDate(true); setDateValue(day.date) } }}
            title={!readOnly ? `${day.date} · Click to edit` : day.date}
          >
            {shortDate(day.date)}
          </span>
        )}
        <span className="text-[10px] text-gray-400">({day.items.length})</span>
      </div>
      {!readOnly && !collapsed && (
        <div className="flex items-center gap-2 pl-3">
          <button data-tour="add-item" onClick={handleAddItem} className="text-[10px] text-indigo-600 hover:underline whitespace-nowrap">+ Add</button>
          <button onClick={handleDeleteDay} className="text-[10px] text-gray-400 hover:text-red-500" title="Delete day">&#10005;</button>
        </div>
      )}
    </div>
  )

  if (collapsed) {
    return (
      <tbody>
        <tr className="border-b border-gray-200">
          <td className="border-r border-gray-200 bg-gray-50 px-2 py-2 w-32">{dateCellContent}</td>
          <td colSpan={totalCols} className="px-3 py-2 text-xs text-gray-400 italic">
            {day.items.length} {day.items.length === 1 ? 'activity' : 'activities'} hidden
          </td>
        </tr>
      </tbody>
    )
  }

  if (day.items.length === 0) {
    return (
      <EmptyDayDropZone dayId={day.id} totalCols={totalCols} dateCellContent={dateCellContent} readOnly={readOnly} />
    )
  }

  // Rows: first row gets the date cell, subsequent rows don't
  const rowSpan = day.items.length

  return (
    <SortableContext items={day.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
      <tbody>
        {day.items.map((item, idx) => (
          <SortableRow
            key={item.id}
            item={item}
            itineraryId={itineraryId}
            baseTimestamps={baseTimestamps}
            columnVisibility={columnVisibility}
            readOnly={readOnly}
            onDelete={handleDeleteItem}
            dateCell={idx === 0 ? dateCellContent : undefined}
            dateCellRowSpan={idx === 0 ? rowSpan : undefined}
          />
        ))}
      </tbody>
    </SortableContext>
  )
}
