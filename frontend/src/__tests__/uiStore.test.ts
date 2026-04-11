import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUIStore } from '../stores/uiStore'

// Mock localStorage for jsdom
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

describe('uiStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      historyDrawerOpen: false,
      shareModalOpen: false,
      membersModalOpen: false,
      toasts: [],
      rightPanel: null,
    })
  })

  it('toggles historyDrawerOpen', () => {
    useUIStore.getState().setHistoryDrawerOpen(true)
    expect(useUIStore.getState().historyDrawerOpen).toBe(true)
    useUIStore.getState().setHistoryDrawerOpen(false)
    expect(useUIStore.getState().historyDrawerOpen).toBe(false)
  })

  it('toggles shareModalOpen', () => {
    useUIStore.getState().setShareModalOpen(true)
    expect(useUIStore.getState().shareModalOpen).toBe(true)
  })

  it('toggles membersModalOpen', () => {
    useUIStore.getState().setMembersModalOpen(true)
    expect(useUIStore.getState().membersModalOpen).toBe(true)
  })

  it('adds and removes toasts', () => {
    useUIStore.getState().addToast('hello', 'info')
    expect(useUIStore.getState().toasts).toHaveLength(1)
    expect(useUIStore.getState().toasts[0].message).toBe('hello')

    const id = useUIStore.getState().toasts[0].id
    useUIStore.getState().removeToast(id)
    expect(useUIStore.getState().toasts).toHaveLength(0)
  })

  it('sets column visibility', () => {
    useUIStore.getState().setColumnVisibility('notes', true)
    expect(useUIStore.getState().columnVisibility['notes']).toBe(true)
    useUIStore.getState().setColumnVisibility('notes', false)
    expect(useUIStore.getState().columnVisibility['notes']).toBe(false)
  })

  it('sets right panel', () => {
    useUIStore.getState().setRightPanel('map')
    expect(useUIStore.getState().rightPanel).toBe('map')
    useUIStore.getState().setRightPanel(null)
    expect(useUIStore.getState().rightPanel).toBeNull()
  })
})
