import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Joyride, STATUS, EVENTS } from 'react-joyride'
import type { EventData } from 'react-joyride'
import { useItineraryStore } from '../stores/itineraryStore'
import { useAlternativeStore } from '../stores/alternativeStore'
import { useDirtyStore } from '../stores/dirtyStore'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import TopBar from '../components/layout/TopBar'
import DaySection from '../components/editor/DaySection'
import RightPanel from '../components/layout/RightPanel'
import HistoryDrawer from '../components/common/HistoryDrawer'
import MembersModal from '../components/common/MembersModal'
import ShareLinksModal from '../components/common/ShareLinksModal'
import { itinerariesApi, authApi } from '../api/client'

const COLUMNS = ['time_start', 'time_end', 'spot_name', 'activity_desc', 'transport', 'estimated_cost', 'booking_status', 'notes']
const COLUMN_LABELS: Record<string, string> = {
  time_start: 'Start', time_end: 'End', spot_name: 'Spot', activity_desc: 'Activity',
  transport: 'Transport', estimated_cost: 'Cost', booking_status: 'Booking', notes: 'Notes',
}

export default function ItineraryEditor() {
  const { id } = useParams<{ id: string }>()
  const { itinerary, load, isLoading, addDay } = useItineraryStore()
  const { loadAll: loadAlternatives } = useAlternativeStore()
  const { pushUndo, markReorder, dirtyCount: getDirtyCount, undo, canUndo } = useDirtyStore()
  const { addToast, columnVisibility, setColumnVisibility, columnWidths, setColumnWidth, leftSidebarOpen, setLeftSidebarOpen } = useUIStore()
  const { user } = useAuthStore()
  const { markOnboardingComplete } = useAuthStore()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const draggingCol = useRef<{ col: string; nextCol: string; startX: number; startW: number; nextStartW: number } | null>(null)

  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [runTour, setRunTour] = useState(false)
  // Track the original position so we know if something changed at drag end
  const dragOrigin = useRef<{ dayId: string; index: number } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const findDayForItem = useCallback((itemId: string) => {
    if (!itinerary) return undefined
    return itinerary.days.find((d) => d.items.some((i) => i.id === itemId))
  }, [itinerary])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    pushUndo() // Snapshot before any drag mutations
    const itemId = String(event.active.id)
    setActiveItemId(itemId)
    const day = findDayForItem(itemId)
    if (day) {
      dragOrigin.current = { dayId: day.id, index: day.items.findIndex((i) => i.id === itemId) }
    }
  }, [findDayForItem, pushUndo])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!itinerary || !id) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const itemId = String(active.id)
    const overId = String(over.id)

    // Empty-day drops are handled in handleDragEnd to avoid unmounting the droppable mid-drag
    if (overId.startsWith('empty-day:')) return

    const fromDay = findDayForItem(itemId)
    const toDay = findDayForItem(overId)
    if (!fromDay || !toDay) return

    // Only handle cross-day moves here; same-day reorder is handled by SortableContext
    if (fromDay.id === toDay.id) return

    const newIndex = toDay.items.findIndex((i) => i.id === overId)
    if (newIndex === -1) return

    useItineraryStore.getState().moveItemToDay(itemId, fromDay.id, toDay.id, newIndex)
  }, [itinerary, id, findDayForItem])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveItemId(null)
    if (!itinerary || !id) return
    const { active, over } = event
    if (!over) return

    const itemId = String(active.id)
    const overId = String(over.id)

    // Handle drop onto empty day — move item there
    if (overId.startsWith('empty-day:')) {
      const toDayId = overId.replace('empty-day:', '')
      const store = useItineraryStore.getState()
      const fromDay = store.itinerary?.days.find((d) => d.items.some((i) => i.id === itemId))
      if (fromDay && fromDay.id !== toDayId) {
        store.moveItemToDay(itemId, fromDay.id, toDayId, 0)
      }
      // Fall through to reorder recording below
    } else {
      const currentDay = findDayForItem(itemId)
      if (!currentDay) { dragOrigin.current = null; return }

      if (active.id !== over.id) {
        // Same-day reorder that SortableContext didn't handle via onDragOver
        const sameDay = currentDay.items.some((i) => i.id === overId)
        if (sameDay) {
          const oldIndex = currentDay.items.findIndex((i) => i.id === itemId)
          const newIndex = currentDay.items.findIndex((i) => i.id === overId)
          if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            useItineraryStore.getState().reorderItem(currentDay.id, oldIndex, newIndex)
          }
        }
      }
    }

    // Read from store directly (not the stale React closure) to get post-reorder state
    const store = useItineraryStore.getState()
    const freshItinerary = store.itinerary
    const freshDay = freshItinerary?.days.find((d) => d.items.some((i) => i.id === itemId))
    if (!freshDay) { dragOrigin.current = null; return }
    const finalIndex = freshDay.items.findIndex((i) => i.id === itemId)
    const origin = dragOrigin.current
    if (origin && (origin.dayId !== freshDay.id || origin.index !== finalIndex)) {
      // Collect all items in affected days, but only record those that differ from server state
      const affectedDayIds = new Set([origin.dayId, freshDay.id])
      const { originalOrders } = store
      let anyRealChange = false
      const reorders: { itemId: string; dayId: string; order: number }[] = []
      for (const dayId of affectedDayIds) {
        const day = freshItinerary?.days.find((d) => d.id === dayId)
        if (!day) continue
        for (const item of day.items) {
          if (item.id.startsWith('temp-')) continue
          const orig = originalOrders[item.id]
          if (!orig || orig.dayId !== dayId || orig.order !== item.item_order) {
            anyRealChange = true
            reorders.push({ itemId: item.id, dayId, order: item.item_order })
          }
        }
      }
      if (anyRealChange) {
        for (const r of reorders) {
          markReorder(id, r.itemId, r.dayId, r.order)
        }
      } else {
        // All items back to original positions — clear any existing reorders and pop snapshot
        useDirtyStore.setState({ pendingReorders: [] })
        const stack = useDirtyStore.getState().undoStack
        if (stack.length > 0) {
          useDirtyStore.setState({ undoStack: stack.slice(0, -1) })
        }
      }
    } else {
      // No actual change — pop the snapshot pushed in handleDragStart
      const stack = useDirtyStore.getState().undoStack
      if (stack.length > 0) {
        useDirtyStore.setState({ undoStack: stack.slice(0, -1) })
      }
    }
    dragOrigin.current = null
  }, [itinerary, id, markReorder, findDayForItem])

  // Visible columns in order, for finding the neighbor to the right
  const visibleColumns = COLUMNS.filter((c) => columnVisibility[c])

  const onColResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault()
    const idx = visibleColumns.indexOf(col)
    if (idx === -1 || idx >= visibleColumns.length - 1) return // can't resize last column's right edge
    const nextCol = visibleColumns[idx + 1]
    draggingCol.current = {
      col,
      nextCol,
      startX: e.clientX,
      startW: columnWidths[col] ?? 100,
      nextStartW: columnWidths[nextCol] ?? 100,
    }

    const onMove = (ev: MouseEvent) => {
      if (!draggingCol.current) return
      const delta = ev.clientX - draggingCol.current.startX
      const newW = Math.max(50, draggingCol.current.startW + delta)
      const newNextW = Math.max(50, draggingCol.current.nextStartW - delta)
      // Only apply if both columns stay above minimum
      if (newW >= 50 && newNextW >= 50) {
        setColumnWidth(draggingCol.current.col, newW)
        setColumnWidth(draggingCol.current.nextCol, newNextW)
      }
    }
    const onUp = () => {
      draggingCol.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [visibleColumns, columnWidths, setColumnWidth])

  useEffect(() => {
    if (id) {
      load(id)
      loadAlternatives(id)
    }
  }, [id, load, loadAlternatives])

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (getDirtyCount() > 0) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [getDirtyCount])

  // Online/offline detection
  useEffect(() => {
    const goOffline = () => { setIsOffline(true); addToast('Network disconnected — changes are kept locally', 'warning') }
    const goOnline = () => { setIsOffline(false); addToast('Back online', 'success') }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline) }
  }, [addToast])

  // Ctrl+Z undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        // Don't intercept if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        if (canUndo()) {
          undo()
          addToast('Undone', 'info')
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, canUndo, addToast])

  // Onboarding tour
  const hasItems = itinerary?.days.some((d) => d.items.length > 0) ?? false
  const hasDays = (itinerary?.days.length ?? 0) > 0

  const tourSteps = [
    {
      target: '[data-tour="add-day"]',
      content: 'Start by adding a day to your itinerary.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    },
    ...(hasDays ? [{
      target: '[data-tour="add-item"]',
      content: 'Add activities to each day.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    }] : []),
    ...(hasItems ? [{
      target: '[data-tour="drag-handle"]',
      content: 'Drag to reorder items, even across days.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    }] : []),
    ...(hasItems ? [{
      target: '[data-tour="alternatives"]',
      content: 'Click \u2605 to view or add alternative suggestions for any field.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    }] : []),
    {
      target: '[data-tour="save"]',
      content: 'Click Save to persist all your changes.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    },
    {
      target: '[data-tour="sync"]',
      content: 'Pull the latest changes from your collaborators.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    },
    {
      target: '[data-tour="columns-sidebar"]',
      content: 'Toggle which columns are visible.',
      skipBeacon: true,
      showProgress: true,
      placement: 'right' as const,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    },
    {
      target: '[data-tour="right-panel-tabs"]',
      content: 'Switch between Map view and AI Chat.',
      skipBeacon: true,
      showProgress: true,
      placement: 'left' as const,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    },
    {
      target: '[data-tour="export-pdf"]',
      content: 'Export your itinerary to PDF.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    },
    {
      target: '[data-tour="share"]',
      content: 'Share via link or manage collaborators.',
      skipBeacon: true,
      showProgress: true,
      buttons: ['skip' as const, 'back' as const, 'close' as const, 'primary' as const],
    },
  ]

  useEffect(() => {
    if (itinerary && user && !user.has_completed_onboarding) {
      const timer = setTimeout(() => setRunTour(true), 500)
      return () => clearTimeout(timer)
    }
  }, [itinerary, user])

  const handleTourEvent = useCallback(async (data: EventData) => {
    const { status, type, step } = data

    // Flash the alternatives button when its step appears
    if (type === EVENTS.STEP_BEFORE && step.target === '[data-tour="alternatives"]') {
      const el = document.querySelector('[data-tour="alternatives"]') as HTMLElement | null
      if (el) {
        el.style.opacity = '1'
        el.classList.add('tour-flash')
      }
    }
    if (type === EVENTS.STEP_AFTER && step.target === '[data-tour="alternatives"]') {
      const el = document.querySelector('[data-tour="alternatives"]') as HTMLElement | null
      if (el) {
        el.style.opacity = ''
        el.classList.remove('tour-flash')
      }
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRunTour(false)
      // Clean up flash class in case tour ends while on alternatives step
      const el = document.querySelector('.tour-flash') as HTMLElement | null
      if (el) { el.style.opacity = ''; el.classList.remove('tour-flash') }
      try {
        await authApi.completeOnboarding()
        markOnboardingComplete()
      } catch {
        markOnboardingComplete()
      }
    }
  }, [markOnboardingComplete])

  if (!id) return <Navigate to="/dashboard" replace />
  if (isLoading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>
  if (!itinerary) return null

  const readOnly = itinerary.my_role === 'viewer'

  const handleAddDay = async (date?: string) => {
    const selectedDate = date ?? (() => {
      const lastDate = itinerary.days.length > 0
        ? itinerary.days[itinerary.days.length - 1].date
        : new Date().toISOString().split('T')[0]
      return new Date(new Date(lastDate).getTime() + 86400000).toISOString().split('T')[0]
    })()
    // If this date already exists locally, just show a toast
    const existingLocal = itinerary.days.find((d) => d.date === selectedDate)
    if (existingLocal) {
      addToast(`${selectedDate} already exists`, 'info')
      return
    }
    try {
      const { data } = await itinerariesApi.createDay(id, selectedDate, itinerary.days.length)
      const alreadyExists = itinerary.days.some((d) => d.id === data.id)
      if (!alreadyExists) {
        addDay({ ...data, items: [] })
      }
    } catch {
      addToast('Failed to add day', 'error')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <TopBar itineraryId={id} readOnly={readOnly} />
      {isOffline && (
        <div className="bg-amber-500 text-white text-xs text-center py-1 px-3">
          You are offline — edits are saved locally and will sync when reconnected
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — column toggles */}
        <aside data-tour="columns-sidebar" className={`border-r bg-white shrink-0 overflow-y-auto transition-all duration-200 ${leftSidebarOpen ? 'w-44 p-3' : 'w-8 p-0'}`}>
          <button
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className={`text-gray-400 hover:text-gray-600 text-xs ${leftSidebarOpen ? 'mb-2 w-full text-right' : 'w-full h-8 flex items-center justify-center'}`}
            title={leftSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {leftSidebarOpen ? '\u25C0' : '\u25B6'}
          </button>
          {leftSidebarOpen && (
            <>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Columns</p>
              {COLUMNS.map((col) => (
                <label key={col} className="flex items-center gap-2 text-xs text-gray-600 py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={columnVisibility[col] ?? true}
                    onChange={(e) => setColumnVisibility(col, e.target.checked)}
                    className="rounded"
                  />
                  {col.replace('_', ' ')}
                </label>
              ))}
            </>
          )}
        </aside>

        {/* Main editor — single spreadsheet */}
        <main className="flex-1 min-w-0 overflow-auto">
          <DndContext sensors={readOnly ? [] : sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            <table className="w-full text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 110 }} />
                {!readOnly && <col style={{ width: 24 }} />}
                {COLUMNS.filter((c) => columnVisibility[c]).map((col) => (
                  <col key={col} style={{ width: columnWidths[col] ?? 100 }} />
                ))}
                {!readOnly && <col style={{ width: 32 }} />}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-gray-100 text-gray-500 uppercase tracking-wide border-b border-gray-300">
                <tr>
                  <th className="text-center px-2 py-2 border-r border-gray-300">Date</th>
                  {!readOnly && <th />}
                  {COLUMNS.filter((c) => columnVisibility[c]).map((col) => (
                    <th key={col} className="text-center px-2 py-2 relative">
                      {COLUMN_LABELS[col]}
                      <div
                        onMouseDown={(e) => onColResizeStart(col, e)}
                        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-indigo-300"
                      />
                    </th>
                  ))}
                  {!readOnly && <th />}
                </tr>
              </thead>
              {itinerary.days.map((day) => (
                <DaySection key={day.id} day={day} itineraryId={id} readOnly={readOnly} />
              ))}
            </table>
            <DragOverlay>
              {activeItemId ? (() => {
                let activeItem: import('../types').Item | undefined
                for (const day of itinerary.days) {
                  activeItem = day.items.find((i) => i.id === activeItemId)
                  if (activeItem) break
                }
                if (!activeItem) return null
                return (
                  <table className="w-full text-xs border-collapse bg-white shadow-lg rounded opacity-90" style={{ tableLayout: 'fixed' }}>
                    <tbody>
                      <tr className="border border-indigo-300">
                        <td className="px-2 py-1 text-gray-400">&#x2807;</td>
                        <td className="px-2 py-1">{activeItem.time_start ?? ''}</td>
                        <td className="px-2 py-1 font-medium">{activeItem.spot_name ?? ''}</td>
                        <td className="px-2 py-1">{activeItem.activity_desc ?? ''}</td>
                        <td className="px-2 py-1">{activeItem.transport ?? ''}</td>
                        <td className="px-2 py-1">{activeItem.estimated_cost ?? ''}</td>
                        <td className="px-2 py-1">{activeItem.notes ?? ''}</td>
                      </tr>
                    </tbody>
                  </table>
                )
              })() : null}
            </DragOverlay>
          </DndContext>
          {!readOnly && (
            <div className="m-3 flex items-center gap-2" data-tour="add-day">
              <button
                onClick={() => handleAddDay()}
                className="text-sm text-indigo-600 hover:underline"
              >
                + Add day
              </button>
              <input
                type="date"
                onChange={(e) => { if (e.target.value) { handleAddDay(e.target.value); e.target.value = '' } }}
                className="text-xs border rounded px-2 py-1 text-gray-500"
                title="Pick a specific date to add"
              />
            </div>
          )}
        </main>

        <RightPanel itineraryId={id} />
      </div>

      <HistoryDrawer itineraryId={id} />
      <MembersModal itineraryId={id} />
      <ShareLinksModal itineraryId={id} />

      <Joyride
        steps={tourSteps}
        run={runTour}
        continuous
        onEvent={handleTourEvent}
        options={{
          primaryColor: '#4f46e5',
          zIndex: 10000,
        }}
        locale={{
          last: 'Done',
        }}
      />
    </div>
  )
}
