import { describe, it, expect, beforeEach } from 'vitest'
import { useDirtyStore } from '../stores/dirtyStore'

describe('dirtyStore', () => {
  beforeEach(() => {
    useDirtyStore.setState({ dirty: {} })
  })

  it('setDirty adds entry', () => {
    useDirtyStore.getState().setDirty('item-1', 'spot_name', 'Temple', '2024-01-01T00:00:00Z')
    const { dirty } = useDirtyStore.getState()
    expect(dirty['item-1']['spot_name'].value).toBe('Temple')
    expect(dirty['item-1']['spot_name'].basedOnUpdatedAt).toBe('2024-01-01T00:00:00Z')
  })

  it('setDirty overwrites existing entry', () => {
    useDirtyStore.getState().setDirty('item-1', 'spot_name', 'A', '2024-01-01T00:00:00Z')
    useDirtyStore.getState().setDirty('item-1', 'spot_name', 'B', '2024-01-01T00:00:00Z')
    expect(useDirtyStore.getState().dirty['item-1']['spot_name'].value).toBe('B')
  })

  it('clearItem removes item entries', () => {
    useDirtyStore.getState().setDirty('item-1', 'spot_name', 'X', '2024-01-01T00:00:00Z')
    useDirtyStore.getState().clearItem('item-1')
    expect(useDirtyStore.getState().dirty['item-1']).toBeUndefined()
  })

  it('hasDirty returns false for clean item', () => {
    expect(useDirtyStore.getState().hasDirty('item-99')).toBe(false)
  })

  it('hasDirty returns true after setDirty', () => {
    useDirtyStore.getState().setDirty('item-2', 'notes', 'hello', '2024-01-01T00:00:00Z')
    expect(useDirtyStore.getState().hasDirty('item-2')).toBe(true)
  })
})
