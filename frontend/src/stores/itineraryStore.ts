import { create } from 'zustand'
import { itinerariesApi } from '../api/client'
import type { ItineraryDetail, DayWithItems, Item } from '../types'

/** Original item placement from last load/save — used to detect no-op reorders */
type OriginalOrders = Record<string, { dayId: string; order: number }>

function buildOriginalOrders(days: DayWithItems[]): OriginalOrders {
  const o: OriginalOrders = {}
  for (const day of days) {
    for (const item of day.items) {
      o[item.id] = { dayId: day.id, order: item.item_order }
    }
  }
  return o
}

interface ItineraryStore {
  itinerary: ItineraryDetail | null
  baseTimestamps: Record<string, Record<string, string>>
  originalOrders: OriginalOrders
  isLoading: boolean
  load: (id: string) => Promise<void>
  applyAcceptedFields: (itemId: string, accepted: string[], newTimestamp: string) => void
  updateItemFields: (itemId: string, fields: Record<string, unknown>) => void
  addItem: (dayId: string, item: Item) => void
  removeItem: (itemId: string) => void
  addDay: (day: DayWithItems) => void
  removeDay: (dayId: string) => void
  updateDay: (dayId: string, fields: Partial<DayWithItems>) => void
  reorderItem: (dayId: string, oldIndex: number, newIndex: number) => void
  moveItemToDay: (itemId: string, fromDayId: string, toDayId: string, newIndex: number) => void
  replaceItemId: (oldId: string, newItem: Item) => void
}

function buildBaseTimestamps(days: DayWithItems[]): Record<string, Record<string, string>> {
  const ts: Record<string, Record<string, string>> = {}
  for (const day of days) {
    for (const item of day.items) {
      ts[item.id] = {
        time_start: item.time_updated_at,
        time_end: item.time_updated_at,
        spot_name: item.spot_updated_at,
        activity_desc: item.activity_updated_at,
        transport: item.transport_updated_at,
        estimated_cost: item.cost_updated_at,
        booking_status: item.booking_status_updated_at,
        booking_url: item.booking_url_updated_at,
        notes: item.notes_updated_at,
        rating: item.rating_updated_at,
      }
    }
  }
  return ts
}

export const useItineraryStore = create<ItineraryStore>((set) => ({
  itinerary: null,
  baseTimestamps: {},
  originalOrders: {},
  isLoading: false,

  load: async (id) => {
    set({ isLoading: true })
    try {
      const { data } = await itinerariesApi.get(id)
      set({
        itinerary: data,
        baseTimestamps: buildBaseTimestamps(data.days),
        originalOrders: buildOriginalOrders(data.days),
        isLoading: false,
      })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  applyAcceptedFields: (itemId, accepted, newTimestamp) => {
    set((state) => {
      const ts = { ...state.baseTimestamps }
      if (ts[itemId]) {
        const itemTs = { ...ts[itemId] }
        for (const field of accepted) {
          itemTs[field] = newTimestamp
        }
        ts[itemId] = itemTs
      }
      return { baseTimestamps: ts }
    })
  },

  updateItemFields: (itemId, fields) => {
    set((state) => {
      if (!state.itinerary) return {}
      const days = state.itinerary.days.map((d) => ({
        ...d,
        items: d.items.map((i) =>
          i.id === itemId ? { ...i, ...fields } : i
        ),
      }))
      return { itinerary: { ...state.itinerary, days } }
    })
  },

  addItem: (dayId, item) => {
    set((state) => {
      if (!state.itinerary) return {}
      const days = state.itinerary.days.map((d) =>
        d.id === dayId ? { ...d, items: [...d.items, item] } : d
      )
      // Populate baseTimestamps for the new item
      const ts = { ...state.baseTimestamps }
      ts[item.id] = {
        time_start: item.time_updated_at,
        time_end: item.time_updated_at,
        spot_name: item.spot_updated_at,
        activity_desc: item.activity_updated_at,
        transport: item.transport_updated_at,
        estimated_cost: item.cost_updated_at,
        booking_status: item.booking_status_updated_at,
        booking_url: item.booking_url_updated_at,
        notes: item.notes_updated_at,
        rating: item.rating_updated_at,
      }
      return { itinerary: { ...state.itinerary, days }, baseTimestamps: ts }
    })
  },

  removeItem: (itemId) => {
    set((state) => {
      if (!state.itinerary) return {}
      const days = state.itinerary.days.map((d) => ({
        ...d,
        items: d.items.filter((i) => i.id !== itemId),
      }))
      return { itinerary: { ...state.itinerary, days } }
    })
  },

  addDay: (day) => {
    set((state) => {
      if (!state.itinerary) return {}
      return { itinerary: { ...state.itinerary, days: [...state.itinerary.days, day] } }
    })
  },

  removeDay: (dayId) => {
    set((state) => {
      if (!state.itinerary) return {}
      const days = state.itinerary.days.filter((d) => d.id !== dayId)
      return { itinerary: { ...state.itinerary, days } }
    })
  },

  reorderItem: (dayId, oldIndex, newIndex) => {
    set((state) => {
      if (!state.itinerary) return {}
      const days = state.itinerary.days.map((d) => {
        if (d.id !== dayId) return d
        const items = [...d.items]
        const [moved] = items.splice(oldIndex, 1)
        items.splice(newIndex, 0, moved)
        // Sync item_order to match array position
        return { ...d, items: items.map((item, idx) => item.item_order === idx ? item : { ...item, item_order: idx }) }
      })
      return { itinerary: { ...state.itinerary, days } }
    })
  },

  moveItemToDay: (itemId, fromDayId, toDayId, newIndex) => {
    set((state) => {
      if (!state.itinerary) return {}
      let movedItem: Item | undefined
      const days = state.itinerary.days.map((d) => {
        if (d.id === fromDayId) {
          const items = d.items.filter((i) => {
            if (i.id === itemId) { movedItem = { ...i, day_id: toDayId }; return false }
            return true
          })
          // Sync item_order for source day
          return { ...d, items: items.map((item, idx) => item.item_order === idx ? item : { ...item, item_order: idx }) }
        }
        return d
      })
      if (!movedItem) return {}
      const finalDays = days.map((d) => {
        if (d.id === toDayId) {
          const items = [...d.items]
          items.splice(newIndex, 0, movedItem!)
          // Sync item_order for target day
          return { ...d, items: items.map((item, idx) => item.item_order === idx ? item : { ...item, item_order: idx }) }
        }
        return d
      })
      return { itinerary: { ...state.itinerary, days: finalDays } }
    })
  },

  replaceItemId: (oldId, newItem) => {
    set((state) => {
      if (!state.itinerary) return {}
      const days = state.itinerary.days.map((d) => ({
        ...d,
        items: d.items.map((i) => (i.id === oldId ? newItem : i)),
      }))
      // Update baseTimestamps: remove old, add new
      const ts = { ...state.baseTimestamps }
      delete ts[oldId]
      ts[newItem.id] = {
        time_start: newItem.time_updated_at,
        time_end: newItem.time_updated_at,
        spot_name: newItem.spot_updated_at,
        activity_desc: newItem.activity_updated_at,
        transport: newItem.transport_updated_at,
        estimated_cost: newItem.cost_updated_at,
        booking_status: newItem.booking_status_updated_at,
        booking_url: newItem.booking_url_updated_at,
        notes: newItem.notes_updated_at,
        rating: newItem.rating_updated_at,
      }
      return { itinerary: { ...state.itinerary, days }, baseTimestamps: ts }
    })
  },

  updateDay: (dayId, fields) => {
    set((state) => {
      if (!state.itinerary) return {}
      let days = state.itinerary.days.map((d) =>
        d.id === dayId ? { ...d, ...fields } : d
      )
      // Re-sort days by date after date change
      if ('date' in fields) {
        days = [...days].sort((a, b) => a.date.localeCompare(b.date))
      }
      return { itinerary: { ...state.itinerary, days } }
    })
  },
}))
