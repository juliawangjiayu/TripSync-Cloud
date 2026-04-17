import { useState, useEffect, useCallback } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useItineraryStore } from '../../stores/itineraryStore'
import { versionsApi } from '../../api/client'
import type { VersionListItem, ChangeSummary } from '../../types'

function formatSummary(s: ChangeSummary): string {
  const parts: string[] = []
  if (s.edits > 0) parts.push(`${s.edits} field${s.edits !== 1 ? 's' : ''} edited`)
  if (s.creates > 0) parts.push(`${s.creates} item${s.creates !== 1 ? 's' : ''} created`)
  if (s.deletes > 0) parts.push(`${s.deletes} item${s.deletes !== 1 ? 's' : ''} deleted`)
  if (s.reorders > 0) parts.push(`${s.reorders} item${s.reorders !== 1 ? 's' : ''} reordered`)
  return parts.length > 0 ? parts.join(', ') : 'snapshot'
}

interface HistoryDrawerProps {
  itineraryId: string
}

export default function HistoryDrawer({ itineraryId }: HistoryDrawerProps) {
  const { historyDrawerOpen, setHistoryDrawerOpen, addToast } = useUIStore()
  const { load } = useItineraryStore()
  const [versions, setVersions] = useState<VersionListItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [rollingBack, setRollingBack] = useState<number | null>(null)

  const PER_PAGE = 20

  const fetchVersions = useCallback(async (p: number, append = false) => {
    setLoading(true)
    try {
      const { data } = await versionsApi.list(itineraryId, p, PER_PAGE)
      setVersions((prev) => append ? [...prev, ...data] : data)
      setHasMore(data.length === PER_PAGE)
    } catch {
      addToast('Failed to load history', 'error')
    } finally {
      setLoading(false)
    }
  }, [itineraryId, addToast])

  useEffect(() => {
    if (historyDrawerOpen) {
      setPage(1)
      setVersions([])
      fetchVersions(1)
    }
  }, [historyDrawerOpen, fetchVersions])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryDrawerOpen(false)
    }
    if (historyDrawerOpen) document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [historyDrawerOpen, setHistoryDrawerOpen])

  const handleLoadMore = () => {
    const next = page + 1
    setPage(next)
    fetchVersions(next, true)
  }

  const handleRollback = async (versionNum: number) => {
    setRollingBack(versionNum)
    try {
      await versionsApi.rollback(itineraryId, versionNum)
      addToast(`Rolled back to version ${versionNum}`, 'success')
      await load(itineraryId)
      setHistoryDrawerOpen(false)
    } catch {
      addToast('Rollback failed', 'error')
    } finally {
      setRollingBack(null)
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString()
  }

  const typeBadge = (type: string) => {
    if (type === 'rollback') return 'bg-orange-100 text-orange-700'
    return 'bg-blue-100 text-blue-700'
  }

  return (
    <>
      {/* Backdrop */}
      {historyDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setHistoryDrawerOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-96 bg-white shadow-xl transform transition-transform duration-200 ${
          historyDrawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-800">Version History</h3>
          <button
            onClick={() => setHistoryDrawerOpen(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto h-[calc(100%-57px)] p-4">
          {versions.length === 0 && !loading && (
            <p className="text-sm text-gray-400 text-center py-8">No version history yet</p>
          )}

          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">v{v.version_num}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${typeBadge(v.entry_type)}`}>
                      {v.entry_type}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRollback(v.version_num)}
                    disabled={rollingBack !== null}
                    className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
                  >
                    {rollingBack === v.version_num ? 'Rolling back...' : 'Rollback'}
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  <span>{formatDate(v.created_at)}</span>
                  <span className="mx-1.5">&middot;</span>
                  <span>{formatSummary(v.change_summary)}</span>
                </div>
              </div>
            ))}
          </div>

          {loading && (
            <p className="text-sm text-gray-400 text-center py-4">Loading...</p>
          )}

          {hasMore && !loading && versions.length > 0 && (
            <button
              onClick={handleLoadMore}
              className="w-full mt-3 text-sm text-indigo-600 hover:underline py-2"
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </>
  )
}
