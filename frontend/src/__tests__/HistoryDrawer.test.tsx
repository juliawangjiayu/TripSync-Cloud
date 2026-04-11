import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HistoryDrawer from '../components/common/HistoryDrawer'
import { useUIStore } from '../stores/uiStore'

vi.mock('../api/client', () => ({
  versionsApi: {
    list: vi.fn().mockResolvedValue({
      data: [
        { id: 'v1', version_num: 1, entry_type: 'edit', author_id: 'u1', created_at: '2026-04-01T10:00:00Z', change_count: 3 },
        { id: 'v2', version_num: 2, entry_type: 'rollback', author_id: 'u1', created_at: '2026-04-01T11:00:00Z', change_count: 1 },
      ],
    }),
    rollback: vi.fn().mockResolvedValue({ data: { new_version_num: 3, message: 'ok' } }),
  },
}))

vi.mock('../stores/itineraryStore', () => ({
  useItineraryStore: () => ({ load: vi.fn() }),
}))

describe('HistoryDrawer', () => {
  beforeEach(() => {
    useUIStore.setState({ historyDrawerOpen: true })
  })

  it('renders version list when open', async () => {
    render(<HistoryDrawer itineraryId="itin-1" />)
    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument()
      expect(screen.getByText('v2')).toBeInTheDocument()
    })
  })

  it('shows entry type badges', async () => {
    render(<HistoryDrawer itineraryId="itin-1" />)
    await waitFor(() => {
      expect(screen.getByText('edit')).toBeInTheDocument()
      expect(screen.getByText('rollback')).toBeInTheDocument()
    })
  })

  it('shows change count', async () => {
    render(<HistoryDrawer itineraryId="itin-1" />)
    await waitFor(() => {
      expect(screen.getByText('3 changes')).toBeInTheDocument()
      expect(screen.getByText('1 change')).toBeInTheDocument()
    })
  })

  it('closes on backdrop click', async () => {
    render(<HistoryDrawer itineraryId="itin-1" />)
    await waitFor(() => screen.getByText('v1'))
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/30')
    if (backdrop) fireEvent.click(backdrop)
    expect(useUIStore.getState().historyDrawerOpen).toBe(false)
  })

  it('does not render versions when closed', () => {
    useUIStore.setState({ historyDrawerOpen: false })
    render(<HistoryDrawer itineraryId="itin-1" />)
    expect(screen.queryByText('v1')).not.toBeInTheDocument()
  })
})
