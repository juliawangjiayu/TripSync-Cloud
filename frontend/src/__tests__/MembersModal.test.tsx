import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MembersModal from '../components/common/MembersModal'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { useItineraryStore } from '../stores/itineraryStore'

const mockUpdateRole = vi.fn().mockResolvedValue({ data: {} })
const mockRemove = vi.fn().mockResolvedValue({ data: {} })

vi.mock('../api/client', () => ({
  membersApi: {
    list: vi.fn().mockResolvedValue({
      data: [
        { user_id: 'owner-1', username: 'Alice', email: 'alice@test.com', role: 'editor', joined_at: '2026-04-01T00:00:00Z', invited_via: null },
        { user_id: 'member-1', username: 'Bob', email: 'bob@test.com', role: 'editor', joined_at: '2026-04-01T01:00:00Z', invited_via: 'link' },
        { user_id: 'member-2', username: 'Carol', email: 'carol@test.com', role: 'viewer', joined_at: '2026-04-01T02:00:00Z', invited_via: 'link' },
      ],
    }),
    updateRole: (...args: unknown[]) => mockUpdateRole(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
  },
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}))

describe('MembersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ membersModalOpen: true })
    useAuthStore.setState({ user: { id: 'owner-1', email: 'alice@test.com', username: 'Alice', has_completed_onboarding: true } })
    useItineraryStore.setState({
      itinerary: { id: 'itin-1', title: 'Trip', folder_id: null, owner_id: 'owner-1', created_at: '', updated_at: '', days: [], my_role: 'editor' },
    })
  })

  it('renders member list when open', async () => {
    render(<MembersModal itineraryId="itin-1" />)
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
      expect(screen.getByText('Carol')).toBeInTheDocument()
    })
  })

  it('shows owner badge for the owner', async () => {
    render(<MembersModal itineraryId="itin-1" />)
    await waitFor(() => {
      expect(screen.getByText('owner')).toBeInTheDocument()
    })
  })

  it('owner can see role dropdowns for non-owner members', async () => {
    render(<MembersModal itineraryId="itin-1" />)
    await waitFor(() => screen.getByText('Bob'))
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)
  })

  it('owner can change a member role', async () => {
    render(<MembersModal itineraryId="itin-1" />)
    await waitFor(() => screen.getByText('Bob'))
    const selects = screen.getAllByRole('combobox')
    await userEvent.selectOptions(selects[0], 'viewer')
    expect(mockUpdateRole).toHaveBeenCalledWith('itin-1', 'member-1', 'viewer')
  })

  it('non-owner sees read-only list without controls', async () => {
    useAuthStore.setState({ user: { id: 'member-1', email: 'bob@test.com', username: 'Bob', has_completed_onboarding: true } })
    render(<MembersModal itineraryId="itin-1" />)
    await waitFor(() => screen.getByText('Alice'))
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })
})
