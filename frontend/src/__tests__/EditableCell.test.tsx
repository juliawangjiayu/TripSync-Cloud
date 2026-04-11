import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditableCell from '../components/editor/EditableCell'
import { useDirtyStore } from '../stores/dirtyStore'

vi.mock('../stores/alternativeStore', () => ({
  useAlternativeStore: () => ({ hasActive: () => false }),
}))

describe('EditableCell', () => {
  it('renders current value', () => {
    render(
      <EditableCell
        itineraryId="itin-1"
        itemId="item-1"
        field="spot_name"
        value="Temple A"
        basedOnUpdatedAt="2024-01-01T00:00:00Z"
      />
    )
    expect(screen.getByText('Temple A')).toBeInTheDocument()
  })

  it('enters edit mode on click', async () => {
    render(
      <EditableCell
        itineraryId="itin-1"
        itemId="item-1"
        field="spot_name"
        value="Temple A"
        basedOnUpdatedAt="2024-01-01T00:00:00Z"
      />
    )
    await userEvent.click(screen.getByText('Temple A'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('writes to dirty store on blur with changed value', async () => {
    useDirtyStore.setState({ dirty: {} })
    render(
      <EditableCell
        itineraryId="itin-1"
        itemId="item-1"
        field="spot_name"
        value="Temple A"
        basedOnUpdatedAt="2024-01-01T00:00:00Z"
      />
    )
    await userEvent.click(screen.getByText('Temple A'))
    const input = screen.getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'Temple B')
    fireEvent.blur(input)

    const { dirty } = useDirtyStore.getState()
    expect(dirty['item-1']['spot_name'].value).toBe('Temple B')
  })

  it('does not write to dirty store if value unchanged', async () => {
    useDirtyStore.setState({ dirty: {} })
    render(
      <EditableCell
        itineraryId="itin-1"
        itemId="item-1"
        field="spot_name"
        value="Same"
        basedOnUpdatedAt="2024-01-01T00:00:00Z"
      />
    )
    await userEvent.click(screen.getByText('Same'))
    fireEvent.blur(screen.getByRole('textbox'))
    expect(useDirtyStore.getState().dirty['item-1']).toBeUndefined()
  })

  it('renders as read-only when readOnly=true', () => {
    render(
      <EditableCell
        itineraryId="itin-1"
        itemId="item-1"
        field="spot_name"
        value="Temple"
        basedOnUpdatedAt="2024-01-01T00:00:00Z"
        readOnly
      />
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Temple')).toBeInTheDocument()
  })
})
