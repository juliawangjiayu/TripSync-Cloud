import { useState, useEffect } from 'react'
import { useAlternativeStore } from '../../stores/alternativeStore'
import { alternativesApi } from '../../api/client'
import { useUIStore } from '../../stores/uiStore'
import { useItineraryStore } from '../../stores/itineraryStore'
import type { LockableField } from '../../types'

interface Props {
  itineraryId: string
  itemId: string
  field: LockableField
  currentValue: string
  onClose: () => void
}

export default function AlternativeDropdown({ itineraryId, itemId, field, currentValue, onClose }: Props) {
  const { alternatives, setAlternatives, dismiss, addAlternative } = useAlternativeStore()
  const { addToast } = useUIStore()
  const { load } = useItineraryStore()
  const alts = alternatives[itemId]?.[field] ?? []
  const [newValue, setNewValue] = useState('')
  const [loading, setLoading] = useState(true)

  // Load alternatives from backend when dropdown opens
  useEffect(() => {
    let cancelled = false
    alternativesApi.list(itineraryId, itemId, field).then(({ data }) => {
      if (!cancelled) {
        setAlternatives(itemId, field, data)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [itineraryId, itemId, field, setAlternatives])

  const handleAdopt = async (altId: string) => {
    try {
      await alternativesApi.adopt(itineraryId, itemId, altId)
      dismiss(itemId, field, altId)
      await load(itineraryId)
      addToast('Alternative adopted and saved', 'success')
      onClose()
    } catch {
      addToast('Failed to adopt alternative', 'error')
    }
  }

  const handleDismiss = async (altId: string) => {
    try {
      await alternativesApi.dismiss(itineraryId, itemId, altId)
      dismiss(itemId, field, altId)
    } catch {
      addToast('Failed to dismiss', 'error')
    }
  }

  const handlePropose = async () => {
    const trimmed = newValue.trim()
    if (!trimmed) return
    try {
      const { data } = await alternativesApi.create(itineraryId, itemId, field, trimmed)
      addAlternative(data)
      setNewValue('')
      addToast('Alternative proposed', 'success')
    } catch {
      addToast('Failed to propose alternative', 'error')
    }
  }

  return (
    <div className="w-72 bg-white border rounded-lg shadow-xl p-2 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-gray-700 text-xs uppercase tracking-wide">Alternatives</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">x</button>
      </div>

      {/* Current value */}
      <div className="px-2 py-1.5 bg-indigo-50 rounded text-indigo-800 font-medium mb-1">
        {currentValue || '(empty)'} <span className="text-xs text-indigo-400 ml-1">current</span>
      </div>

      {/* Alternatives list */}
      {loading ? (
        <p className="text-xs text-gray-400 px-2 py-1">Loading...</p>
      ) : (
        <>
          {alts.map((alt) => (
            <div key={alt.id} className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-50 rounded">
              <span className="flex-1 truncate text-gray-700">{alt.value}</span>
              <button
                onClick={() => handleAdopt(alt.id)}
                className="text-xs text-indigo-600 hover:underline shrink-0"
              >
                Use
              </button>
              <button
                onClick={() => handleDismiss(alt.id)}
                className="text-xs text-gray-400 hover:text-red-500 shrink-0"
              >
                x
              </button>
            </div>
          ))}

          {alts.length === 0 && (
            <p className="text-xs text-gray-400 px-2 py-1">No alternatives yet</p>
          )}
        </>
      )}

      {/* Propose new alternative */}
      <div className="mt-2 border-t pt-2 flex gap-1">
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handlePropose() }}
          placeholder="Propose alternative..."
          className="flex-1 text-xs border rounded px-2 py-1 outline-none focus:border-indigo-400"
        />
        <button
          onClick={handlePropose}
          disabled={!newValue.trim()}
          className="text-xs bg-indigo-600 text-white px-2 py-1 rounded disabled:opacity-40 hover:bg-indigo-700"
        >
          Add
        </button>
      </div>
    </div>
  )
}
