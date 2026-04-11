import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShareLinksModal from '../components/common/ShareLinksModal'
import { useUIStore } from '../stores/uiStore'

const mockCreateLink = vi.fn().mockResolvedValue({
  data: { token: 'abc123', url: 'http://localhost:3000/join/abc123', role: 'editor' },
})

vi.mock('../api/client', () => ({
  sharingApi: {
    createLink: (...args: unknown[]) => mockCreateLink(...args),
  },
}))

// Mock clipboard
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

describe('ShareLinksModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ shareModalOpen: true })
  })

  it('renders role selector with editor selected by default', () => {
    render(<ShareLinksModal itineraryId="itin-1" />)
    expect(screen.getByText('Editor')).toBeInTheDocument()
    expect(screen.getByText('Viewer')).toBeInTheDocument()
    expect(screen.getByText('Generate Link')).toBeInTheDocument()
  })

  it('generates a link with selected role', async () => {
    render(<ShareLinksModal itineraryId="itin-1" />)
    await userEvent.click(screen.getByText('Generate Link'))
    await waitFor(() => {
      expect(mockCreateLink).toHaveBeenCalledWith('itin-1', 'editor')
    })
    expect(screen.getByDisplayValue('http://localhost:3000/join/abc123')).toBeInTheDocument()
  })

  it('can switch to viewer role before generating', async () => {
    render(<ShareLinksModal itineraryId="itin-1" />)
    await userEvent.click(screen.getByText('Viewer'))
    mockCreateLink.mockResolvedValueOnce({
      data: { token: 'xyz', url: 'http://localhost:3000/join/xyz', role: 'viewer' },
    })
    await userEvent.click(screen.getByText('Generate Link'))
    await waitFor(() => {
      expect(mockCreateLink).toHaveBeenCalledWith('itin-1', 'viewer')
    })
  })

  it('copies link to clipboard on copy click', async () => {
    render(<ShareLinksModal itineraryId="itin-1" />)
    await userEvent.click(screen.getByText('Generate Link'))
    await waitFor(() => screen.getByText('Copy'))
    await userEvent.click(screen.getByText('Copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/join/abc123')
  })

  it('has a link to view members', () => {
    render(<ShareLinksModal itineraryId="itin-1" />)
    expect(screen.getByText(/View members/)).toBeInTheDocument()
  })
})
