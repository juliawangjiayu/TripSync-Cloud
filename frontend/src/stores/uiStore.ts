import { create } from 'zustand'

type RightPanel = 'map' | 'chat' | null

const COLUMN_VISIBILITY_KEY = 'tripsync_column_visibility'

const defaultColumnVisibility: Record<string, boolean> = {
  time_start: true,
  time_end: true,
  spot_name: true,
  activity_desc: true,
  transport: true,
  estimated_cost: true,
  booking_status: false,
  booking_url: false,
  notes: false,
  rating: false,
}

function loadColumnVisibility(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY)
    return raw ? JSON.parse(raw) : defaultColumnVisibility
  } catch {
    return defaultColumnVisibility
  }
}

interface UIStore {
  rightPanel: RightPanel
  leftSidebarOpen: boolean
  rightPanelOpen: boolean
  rightPanelWidth: number
  historyDrawerOpen: boolean
  shareModalOpen: boolean
  membersModalOpen: boolean
  columnVisibility: Record<string, boolean>
  columnWidths: Record<string, number>
  toasts: { id: string; message: string; type: 'info' | 'error' | 'success' | 'warning' }[]
  setRightPanel: (panel: RightPanel) => void
  setLeftSidebarOpen: (open: boolean) => void
  setRightPanelOpen: (open: boolean) => void
  setRightPanelWidth: (width: number) => void
  setHistoryDrawerOpen: (open: boolean) => void
  setShareModalOpen: (open: boolean) => void
  setMembersModalOpen: (open: boolean) => void
  setColumnVisibility: (col: string, visible: boolean) => void
  setColumnWidth: (col: string, width: number) => void
  addToast: (message: string, type?: 'info' | 'error' | 'success' | 'warning') => void
  removeToast: (id: string) => void
}

export const useUIStore = create<UIStore>((set, get) => ({
  rightPanel: null,
  leftSidebarOpen: true,
  rightPanelOpen: true,
  rightPanelWidth: 288,
  historyDrawerOpen: false,
  shareModalOpen: false,
  membersModalOpen: false,
  columnVisibility: loadColumnVisibility(),
  columnWidths: {
    time_start: 100, time_end: 100, spot_name: 140, activity_desc: 180,
    transport: 100, estimated_cost: 90, booking_status: 110, notes: 180,
  },
  toasts: [],

  setRightPanel: (panel) => set({ rightPanel: panel }),
  setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(200, Math.min(600, width)) }),
  setHistoryDrawerOpen: (open) => set({ historyDrawerOpen: open }),
  setShareModalOpen: (open) => set({ shareModalOpen: open }),
  setMembersModalOpen: (open) => set({ membersModalOpen: open }),

  setColumnWidth: (col, width) => {
    set((state) => ({
      columnWidths: { ...state.columnWidths, [col]: Math.max(50, width) },
    }))
  },

  setColumnVisibility: (col, visible) => {
    set((state) => {
      const next = { ...state.columnVisibility, [col]: visible }
      localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(next))
      return { columnVisibility: next }
    })
  },

  addToast: (message, type = 'info') => {
    const id = String(Date.now())
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }))
    setTimeout(() => get().removeToast(id), 4000)
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
}))
