import { create } from 'zustand'
import { alternativesApi } from '../api/client'
import type { Alternative } from '../types'

interface AlternativeStore {
  alternatives: Record<string, Record<string, Alternative[]>>
  loadAll: (itineraryId: string) => Promise<void>
  setAlternatives: (itemId: string, field: string, alts: Alternative[]) => void
  addAlternative: (alt: Alternative) => void
  dismiss: (itemId: string, field: string, altId: string) => void
  hasActive: (itemId: string, field: string) => boolean
}

export const useAlternativeStore = create<AlternativeStore>((set, get) => ({
  alternatives: {},

  loadAll: async (itineraryId) => {
    const { data } = await alternativesApi.listAll(itineraryId)
    // Group by itemId → fieldName
    const grouped: Record<string, Record<string, Alternative[]>> = {}
    for (const alt of data) {
      if (!grouped[alt.item_id]) grouped[alt.item_id] = {}
      if (!grouped[alt.item_id][alt.field_name]) grouped[alt.item_id][alt.field_name] = []
      grouped[alt.item_id][alt.field_name].push(alt)
    }
    set({ alternatives: grouped })
  },

  setAlternatives: (itemId, field, alts) => {
    set((state) => ({
      alternatives: {
        ...state.alternatives,
        [itemId]: {
          ...state.alternatives[itemId],
          [field]: alts,
        },
      },
    }))
  },

  addAlternative: (alt) => {
    set((state) => {
      const existing = state.alternatives[alt.item_id]?.[alt.field_name] ?? []
      return {
        alternatives: {
          ...state.alternatives,
          [alt.item_id]: {
            ...state.alternatives[alt.item_id],
            [alt.field_name]: [...existing, alt],
          },
        },
      }
    })
  },

  dismiss: (itemId, field, altId) => {
    set((state) => {
      const alts = state.alternatives[itemId]?.[field] ?? []
      return {
        alternatives: {
          ...state.alternatives,
          [itemId]: {
            ...state.alternatives[itemId],
            [field]: alts.filter((a) => a.id !== altId),
          },
        },
      }
    })
  },

  hasActive: (itemId, field) => {
    const { alternatives } = get()
    return (alternatives[itemId]?.[field]?.length ?? 0) > 0
  },
}))
