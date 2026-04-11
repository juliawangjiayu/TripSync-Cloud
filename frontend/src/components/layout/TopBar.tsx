import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItineraryStore } from '../../stores/itineraryStore'
import { useDirtyStore } from '../../stores/dirtyStore'
import { useAlternativeStore } from '../../stores/alternativeStore'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'
import { itinerariesApi } from '../../api/client'

interface TopBarProps {
  itineraryId: string
  readOnly?: boolean
}

export default function TopBar({ itineraryId, readOnly = false }: TopBarProps) {
  const { itinerary } = useItineraryStore()
  const { saveAll, dirtyCount: getDirtyCount, undo, canUndo } = useDirtyStore()
  const { logout } = useAuthStore()
  const { addToast, setHistoryDrawerOpen, setShareModalOpen, setMembersModalOpen } = useUIStore()
  const navigate = useNavigate()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [syncing, setSyncing] = useState(false)

  const dirtyCount = getDirtyCount()

  const handleSaveAll = async () => {
    try {
      const { conflictCount, deletedCount } = await saveAll(itineraryId)
      // Reload itinerary and alternatives to sync other collaborators' changes
      await Promise.all([
        useItineraryStore.getState().load(itineraryId),
        useAlternativeStore.getState().loadAll(itineraryId),
      ])
      const messages: string[] = []
      if (deletedCount > 0) {
        messages.push(`${deletedCount} item(s) were deleted by another user and removed`)
      }
      if (conflictCount > 0) {
        messages.push(`${conflictCount} conflict(s) — your edits were moved to Alternatives (★)`)
      }
      if (messages.length > 0) {
        addToast(messages.join('. '), 'warning')
      } else {
        addToast('All changes saved', 'success')
      }
    } catch {
      addToast('Save failed', 'error')
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await Promise.all([
        useItineraryStore.getState().load(itineraryId),
        useAlternativeStore.getState().loadAll(itineraryId),
      ])
      // Update basedOnUpdatedAt for dirty fields so they don't falsely conflict
      const dirtyState = useDirtyStore.getState()
      const newTimestamps = useItineraryStore.getState().baseTimestamps
      const currentDirty = dirtyState.dirty
      for (const [itemId, fields] of Object.entries(currentDirty)) {
        if (itemId.startsWith('temp-')) continue
        const itemTs = newTimestamps[itemId]
        if (!itemTs) continue
        for (const [field, entry] of Object.entries(fields)) {
          const serverTs = itemTs[field]
          if (serverTs && serverTs !== entry.basedOnUpdatedAt) {
            dirtyState.setDirty(itemId, field, entry.value, serverTs)
          }
        }
      }
      addToast('Synced', 'success')
    } catch {
      addToast('Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const handleExportPDF = async () => {
    try {
      const response = await itinerariesApi.exportPDF(itineraryId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${itinerary?.title || 'itinerary'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      addToast('PDF export failed', 'error')
    }
  }

  const handleTitleSave = async () => {
    setEditingTitle(false)
    if (!titleValue.trim() || titleValue.trim() === itinerary?.title) return
    try {
      await itinerariesApi.update(itineraryId, { title: titleValue.trim() })
      // Reload to get updated title in store
      await useItineraryStore.getState().load(itineraryId)
    } catch {
      addToast('Failed to rename', 'error')
    }
  }

  return (
    <header className="h-12 bg-white border-b flex items-center px-4 gap-3 shrink-0">
      <button onClick={() => navigate('/dashboard')} className="text-gray-400 hover:text-gray-600 text-sm">
        &larr; Dashboard
      </button>

      {!readOnly && editingTitle ? (
        <input
          autoFocus
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setEditingTitle(false) }}
          className="font-semibold text-gray-800 flex-1 border-b border-indigo-300 outline-none bg-transparent"
        />
      ) : (
        <h1
          className={`font-semibold text-gray-800 truncate flex-1 ${!readOnly ? 'cursor-pointer hover:text-indigo-600' : ''}`}
          onClick={() => { if (!readOnly) { setEditingTitle(true); setTitleValue(itinerary?.title ?? '') } }}
          title={!readOnly ? 'Click to rename' : undefined}
        >
          {itinerary?.title ?? '...'}
        </h1>
      )}

      {!readOnly && (
        <>
          <button
            data-tour="sync"
            onClick={handleSync}
            disabled={syncing}
            className="text-xs border px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-40"
            title="Sync collaborators' changes"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            onClick={() => { if (canUndo()) { undo(); addToast('Undone', 'info') } }}
            disabled={!canUndo()}
            className="text-xs border px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-40"
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            data-tour="save"
            onClick={handleSaveAll}
            disabled={dirtyCount === 0}
            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded disabled:opacity-40 hover:bg-indigo-700"
          >
            Save {dirtyCount > 0 ? `(${dirtyCount})` : ''}
          </button>
          <button
            onClick={() => setHistoryDrawerOpen(true)}
            className="text-xs border px-3 py-1.5 rounded hover:bg-gray-50"
          >
            History
          </button>
          <button
            data-tour="share"
            onClick={() => setShareModalOpen(true)}
            className="text-xs border px-3 py-1.5 rounded hover:bg-gray-50"
          >
            Share
          </button>
          <button
            data-tour="members"
            onClick={() => setMembersModalOpen(true)}
            className="text-xs border px-3 py-1.5 rounded hover:bg-gray-50"
          >
            Members
          </button>
          <button
            data-tour="export-pdf"
            onClick={handleExportPDF}
            className="text-xs border px-3 py-1.5 rounded hover:bg-gray-50"
          >
            Export PDF
          </button>
        </>
      )}
      <button
        onClick={() => { logout(); navigate('/login') }}
        className="text-xs text-gray-400 hover:text-gray-600 ml-auto"
        title="Sign out"
      >
        Sign out
      </button>
    </header>
  )
}
