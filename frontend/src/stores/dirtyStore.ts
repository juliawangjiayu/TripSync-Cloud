import { create } from 'zustand'
import { itinerariesApi } from '../api/client'
import { useItineraryStore } from './itineraryStore'
import { useAlternativeStore } from './alternativeStore'
import type { PatchItemResponse, DayWithItems } from '../types'

interface DirtyEntry {
  value: unknown
  basedOnUpdatedAt: string
}

interface SaveResult {
  response: PatchItemResponse
  hadConflicts: boolean
  deletedByOther?: boolean
}

interface PendingReorder {
  itineraryId: string
  itemId: string
  dayId: string
  newOrder: number
}

interface PendingDayUpdate {
  itineraryId: string
  dayId: string
  fields: Record<string, unknown>
}

/** Snapshot of all local state needed to undo one operation */
interface UndoSnapshot {
  dirty: Record<string, Record<string, DirtyEntry>>
  pendingDeleteItems: { itineraryId: string; itemId: string }[]
  pendingDeleteDays: { itineraryId: string; dayId: string }[]
  pendingDayUpdates: PendingDayUpdate[]
  pendingReorders: PendingReorder[]
  /** Deep-cloned itinerary days at time of snapshot */
  days: DayWithItems[]
}

const MAX_UNDO = 50

interface DirtyStore {
  dirty: Record<string, Record<string, DirtyEntry>>
  pendingDeleteItems: { itineraryId: string; itemId: string }[]
  pendingDeleteDays: { itineraryId: string; dayId: string }[]
  pendingDayUpdates: PendingDayUpdate[]
  pendingReorders: PendingReorder[]
  undoStack: UndoSnapshot[]
  /** Capture a snapshot before making changes. Call this BEFORE mutating itineraryStore. */
  pushUndo: () => void
  setDirty: (itemId: string, field: string, value: unknown, basedOnUpdatedAt: string) => void
  clearItem: (itemId: string) => void
  hasDirty: (itemId: string) => boolean
  markDeleteItem: (itineraryId: string, itemId: string) => void
  markDeleteDay: (itineraryId: string, dayId: string) => void
  markDayUpdate: (itineraryId: string, dayId: string, fields: Record<string, unknown>) => void
  markReorder: (itineraryId: string, itemId: string, dayId: string, newOrder: number) => void
  undo: () => void
  canUndo: () => boolean
  save: (itineraryId: string, itemId: string) => Promise<SaveResult>
  saveAll: (itineraryId: string) => Promise<{ conflictCount: number; deletedCount: number }>
  dirtyCount: () => number
}

function cloneDays(): DayWithItems[] {
  const itin = useItineraryStore.getState().itinerary
  if (!itin) return []
  return JSON.parse(JSON.stringify(itin.days))
}

export const useDirtyStore = create<DirtyStore>((set, get) => ({
  dirty: {},
  pendingDeleteItems: [],
  pendingDeleteDays: [],
  pendingDayUpdates: [],
  pendingReorders: [],
  undoStack: [],

  pushUndo: () => {
    const s = get()
    const snapshot: UndoSnapshot = {
      dirty: JSON.parse(JSON.stringify(s.dirty)),
      pendingDeleteItems: [...s.pendingDeleteItems],
      pendingDeleteDays: [...s.pendingDeleteDays],
      pendingDayUpdates: JSON.parse(JSON.stringify(s.pendingDayUpdates)),
      pendingReorders: [...s.pendingReorders],
      days: cloneDays(),
    }
    set((state) => ({
      undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot],
    }))
  },

  setDirty: (itemId, field, value, basedOnUpdatedAt) => {
    // setDirty doesn't mutate itineraryStore, so it pushes its own snapshot
    get().pushUndo()
    set((state) => ({
      dirty: {
        ...state.dirty,
        [itemId]: {
          ...state.dirty[itemId],
          [field]: { value, basedOnUpdatedAt },
        },
      },
    }))
  },

  clearItem: (itemId) => {
    set((state) => {
      const next = { ...state.dirty }
      delete next[itemId]
      return { dirty: next }
    })
  },

  hasDirty: (itemId) => {
    const { dirty } = get()
    return !!dirty[itemId] && Object.keys(dirty[itemId]).length > 0
  },

  markDeleteItem: (itineraryId, itemId) => {
    // Caller must call pushUndo() BEFORE mutating itineraryStore
    set((state) => {
      const next = { ...state.dirty }
      delete next[itemId]
      return {
        dirty: next,
        pendingDeleteItems: [...state.pendingDeleteItems, { itineraryId, itemId }],
      }
    })
  },

  markDeleteDay: (itineraryId, dayId) => {
    // Caller must call pushUndo() BEFORE mutating itineraryStore
    set((state) => {
      const itinStore = useItineraryStore.getState()
      const dayItems = itinStore.itinerary?.days.find((d) => d.id === dayId)?.items ?? []
      const next = { ...state.dirty }
      for (const item of dayItems) {
        delete next[item.id]
      }
      const dayItemIds = new Set(dayItems.map((i) => i.id))
      const filteredItemDeletes = state.pendingDeleteItems.filter(
        (d) => !dayItemIds.has(d.itemId)
      )
      return {
        dirty: next,
        pendingDeleteItems: filteredItemDeletes,
        pendingDeleteDays: [...state.pendingDeleteDays, { itineraryId, dayId }],
      }
    })
  },

  markDayUpdate: (itineraryId, dayId, fields) => {
    // Caller must call pushUndo() BEFORE mutating itineraryStore
    set((state) => {
      const existing = state.pendingDayUpdates.find((u) => u.dayId === dayId)
      if (existing) {
        return {
          pendingDayUpdates: state.pendingDayUpdates.map((u) =>
            u.dayId === dayId ? { ...u, fields: { ...u.fields, ...fields } } : u
          ),
        }
      }
      return {
        pendingDayUpdates: [...state.pendingDayUpdates, { itineraryId, dayId, fields }],
      }
    })
  },

  markReorder: (itineraryId, itemId, dayId, newOrder) => {
    // Caller must call pushUndo() BEFORE mutating itineraryStore
    set((state) => {
      const filtered = state.pendingReorders.filter((r) => r.itemId !== itemId)
      return {
        pendingReorders: [...filtered, { itineraryId, itemId, dayId, newOrder }],
      }
    })
  },

  undo: () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return
    const snapshot = undoStack[undoStack.length - 1]
    // Restore dirty store state
    set({
      dirty: snapshot.dirty,
      pendingDeleteItems: snapshot.pendingDeleteItems,
      pendingDeleteDays: snapshot.pendingDeleteDays,
      pendingDayUpdates: snapshot.pendingDayUpdates,
      pendingReorders: snapshot.pendingReorders,
      undoStack: undoStack.slice(0, -1),
    })
    // Restore itinerary days
    const itinStore = useItineraryStore.getState()
    if (itinStore.itinerary) {
      useItineraryStore.setState({
        itinerary: { ...itinStore.itinerary, days: snapshot.days },
      })
    }
  },

  canUndo: () => get().undoStack.length > 0,

  dirtyCount: () => {
    const { dirty, pendingDeleteItems, pendingDeleteDays, pendingDayUpdates } = get()
    const fieldCount = Object.values(dirty).reduce(
      (sum, fields) => sum + Object.keys(fields).length, 0
    )
    // Count temp items in the itinerary store (not yet persisted to server)
    const itinStore = useItineraryStore.getState()
    const tempItemCount = (itinStore.itinerary?.days ?? []).reduce(
      (sum, day) => sum + day.items.filter((i) => i.id.startsWith('temp-')).length, 0
    )
    const hasReorders = get().pendingReorders.length > 0 ? 1 : 0
    return fieldCount + tempItemCount + pendingDeleteItems.length + pendingDeleteDays.length + pendingDayUpdates.length + hasReorders
  },

  save: async (itineraryId, itemId) => {
    const { dirty, clearItem } = get()
    const itemDirty = dirty[itemId]
    if (!itemDirty || Object.keys(itemDirty).length === 0) {
      return { response: { accepted: [], conflicted: [], conflicted_fields: [], alternatives_created: [] }, hadConflicts: false }
    }

    const changes = Object.entries(itemDirty)
      .filter(([, entry]) => !!entry.basedOnUpdatedAt)
      .map(([field, entry]) => ({
        field,
        value: entry.value,
        based_on_updated_at: entry.basedOnUpdatedAt,
      }))

    if (changes.length === 0) {
      clearItem(itemId)
      return { response: { accepted: [], conflicted: [], conflicted_fields: [], alternatives_created: [] }, hadConflicts: false }
    }

    let data: PatchItemResponse
    try {
      const resp = await itinerariesApi.patchItem(itineraryId, itemId, changes)
      data = resp.data
    } catch (err: unknown) {
      // Item was deleted by another user — clean up locally
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { status?: number } }
        if (axiosErr.response?.status === 404) {
          clearItem(itemId)
          useItineraryStore.getState().removeItem(itemId)
          return { response: { accepted: [], conflicted: [], conflicted_fields: [], alternatives_created: [] }, hadConflicts: false, deletedByOther: true }
        }
      }
      throw err
    }

    if (data.accepted.length > 0) {
      const now = new Date().toISOString()
      const store = useItineraryStore.getState()
      store.applyAcceptedFields(itemId, data.accepted, now)
      // Sync accepted dirty values into the itinerary store so they persist after clearing dirty state
      const acceptedFields: Record<string, unknown> = {}
      for (const field of data.accepted) {
        if (itemDirty[field]) {
          acceptedFields[field] = itemDirty[field].value
        }
      }
      if (Object.keys(acceptedFields).length > 0) {
        store.updateItemFields(itemId, acceptedFields)
      }
    }

    // For conflicted fields, update the cell to show the server's current value
    if (data.conflicted_fields && data.conflicted_fields.length > 0) {
      const store = useItineraryStore.getState()
      const fieldValues: Record<string, unknown> = {}
      const acceptedFields: string[] = []
      for (const cf of data.conflicted_fields) {
        fieldValues[cf.field] = cf.current_value
        acceptedFields.push(cf.field)
      }
      store.updateItemFields(itemId, fieldValues)
      // Update base timestamps so future edits use the correct base
      store.applyAcceptedFields(itemId, acceptedFields, data.conflicted_fields[0].updated_at)
      // Per-field timestamps may differ, apply individually
      for (const cf of data.conflicted_fields) {
        store.applyAcceptedFields(itemId, [cf.field], cf.updated_at)
      }
    }

    // Store any conflict-generated alternatives so they appear in the UI
    if (data.alternatives_created.length > 0) {
      const altStore = useAlternativeStore.getState()
      for (const alt of data.alternatives_created) {
        altStore.addAlternative(alt)
      }
    }

    clearItem(itemId)

    return { response: data, hadConflicts: data.conflicted.length > 0 }
  },

  saveAll: async (itineraryId) => {
    const { dirty, save, pendingDeleteItems, pendingDeleteDays, pendingDayUpdates, clearItem } = get()

    // 0. Create temp items on server first (with their dirty field values)
    const itinStore = useItineraryStore.getState()
    const tempItemIds = Object.keys(dirty).filter((id) => id.startsWith('temp-'))
    const createFailures: unknown[] = []
    for (const tempId of tempItemIds) {
      // Find the temp item in the itinerary store to get its day_id and item_order
      let tempItem: import('../types').Item | undefined
      for (const day of itinStore.itinerary?.days ?? []) {
        tempItem = day.items.find((i) => i.id === tempId)
        if (tempItem) break
      }
      if (!tempItem) {
        clearItem(tempId)
        continue
      }
      // Build create payload from dirty fields
      const itemDirty = dirty[tempId] ?? {}
      const createPayload: Record<string, unknown> = { item_order: tempItem.item_order }
      for (const [field, entry] of Object.entries(itemDirty)) {
        createPayload[field] = entry.value
      }
      // If no fields were edited, skip creating an empty item
      if (Object.keys(itemDirty).length === 0) {
        clearItem(tempId)
        // Remove temp item from local store
        itinStore.removeItem(tempId)
        continue
      }
      try {
        const { data: newItem } = await itinerariesApi.createItem(itineraryId, tempItem.day_id, createPayload)
        itinStore.replaceItemId(tempId, newItem)
        clearItem(tempId)
      } catch (e) {
        createFailures.push(e)
      }
    }

    // 1. Save dirty field changes for existing (non-temp) items
    const realItemIds = Object.keys(get().dirty).filter((id) => !id.startsWith('temp-'))
    const results = await Promise.allSettled(realItemIds.map((itemId) => save(itineraryId, itemId)))
    const failed = results.filter((r) => r.status === 'rejected')
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<SaveResult> => r.status === 'fulfilled')
    const conflictCount = fulfilled.filter((r) => r.value.hadConflicts).length
    const deletedCount = fulfilled.filter((r) => r.value.deletedByOther).length

    // 2. Execute pending reorders (404 = item was deleted, treat as success)
    const { pendingReorders } = get()
    const reorderResults = await Promise.allSettled(
      pendingReorders.map(({ itineraryId: iId, itemId, dayId, newOrder }) =>
        itinerariesApi.reorderItem(iId, itemId, dayId, newOrder).catch((err: unknown) => {
          if (err && typeof err === 'object' && 'response' in err) {
            const axiosErr = err as { response?: { status?: number } }
            if (axiosErr.response?.status === 404) return
          }
          throw err
        })
      )
    )
    const failedReorders = reorderResults.filter((r) => r.status === 'rejected')

    // 3. Execute pending day updates (date changes, etc.)
    const dayUpdateResults = await Promise.allSettled(
      pendingDayUpdates.map(({ itineraryId: iId, dayId, fields }) =>
        itinerariesApi.updateDay(iId, dayId, fields)
      )
    )
    const failedDayUpdates = dayUpdateResults.filter((r) => r.status === 'rejected')

    // 3. Execute pending item deletions (404 = already deleted, treat as success)
    const itemDeleteResults = await Promise.allSettled(
      pendingDeleteItems.map(({ itineraryId: iId, itemId }) =>
        itinerariesApi.deleteItem(iId, itemId).catch((err: unknown) => {
          if (err && typeof err === 'object' && 'response' in err) {
            const axiosErr = err as { response?: { status?: number } }
            if (axiosErr.response?.status === 404) return // already deleted
          }
          throw err
        })
      )
    )
    const failedItemDeletes = itemDeleteResults.filter((r) => r.status === 'rejected')

    // 4. Execute pending day deletions (404 = already deleted, treat as success)
    const dayDeleteResults = await Promise.allSettled(
      pendingDeleteDays.map(({ itineraryId: iId, dayId }) =>
        itinerariesApi.deleteDay(iId, dayId).catch((err: unknown) => {
          if (err && typeof err === 'object' && 'response' in err) {
            const axiosErr = err as { response?: { status?: number } }
            if (axiosErr.response?.status === 404) return // already deleted
          }
          throw err
        })
      )
    )
    const failedDayDeletes = dayDeleteResults.filter((r) => r.status === 'rejected')

    // Clear all pending operations and undo stack
    set({ pendingDeleteItems: [], pendingDeleteDays: [], pendingDayUpdates: [], pendingReorders: [], undoStack: [] })

    const totalFailed = createFailures.length + failed.length + failedReorders.length + failedDayUpdates.length + failedItemDeletes.length + failedDayDeletes.length
    if (totalFailed > 0) {
      throw new Error(`${totalFailed} operation(s) failed to save`)
    }
    return { conflictCount, deletedCount }
  },
}))
