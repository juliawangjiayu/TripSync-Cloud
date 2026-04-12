import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { foldersApi, itinerariesApi } from '../api/client'
import type { Folder, Itinerary } from '../types'
import { format } from 'date-fns'

export default function Dashboard() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [itineraries, setItineraries] = useState<Itinerary[]>([])
  const [newFolderName, setNewFolderName] = useState('')
  const [newItinTitle, setNewItinTitle] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [editingItinId, setEditingItinId] = useState<string | null>(null)
  const [editingItinTitle, setEditingItinTitle] = useState('')
  const { user, logout } = useAuthStore()
  const { addToast } = useUIStore()
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([foldersApi.list(), itinerariesApi.list()]).then(([f, i]) => {
      setFolders(f.data)
      setItineraries(i.data)
    }).catch(() => {
      // Auth interceptor handles 401 redirect; ignore here
    })
  }, [])

  // --- Folder actions ---
  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFolderName.trim()) return
    const { data } = await foldersApi.create(newFolderName.trim())
    setFolders((f) => [...f, data])
    setNewFolderName('')
  }

  const renameFolder = async (id: string) => {
    if (!editingFolderName.trim()) { setEditingFolderId(null); return }
    try {
      const { data } = await foldersApi.update(id, editingFolderName.trim())
      setFolders((prev) => prev.map((f) => (f.id === id ? data : f)))
    } catch {
      addToast('Failed to rename folder', 'error')
    }
    setEditingFolderId(null)
  }

  const deleteFolder = async (id: string, name: string) => {
    if (!confirm(`Delete folder "${name}"? Itineraries inside will be moved out, not deleted.`)) return
    try {
      await foldersApi.delete(id)
      setFolders((prev) => prev.filter((f) => f.id !== id))
      if (selectedFolder === id) setSelectedFolder(null)
      // Refresh itineraries since their folder_id may be nullified
      const { data } = await itinerariesApi.list()
      setItineraries(data)
    } catch {
      addToast('Failed to delete folder', 'error')
    }
  }

  // --- Itinerary actions ---
  const createItinerary = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItinTitle.trim()) return
    const { data } = await itinerariesApi.create(newItinTitle.trim(), selectedFolder ?? undefined)
    setItineraries((i) => [...i, data])
    setNewItinTitle('')
    navigate(`/itineraries/${data.id}`)
  }

  const renameItinerary = async (id: string) => {
    if (!editingItinTitle.trim()) { setEditingItinId(null); return }
    try {
      const { data } = await itinerariesApi.update(id, { title: editingItinTitle.trim() })
      setItineraries((prev) => prev.map((i) => (i.id === id ? data : i)))
    } catch {
      addToast('Failed to rename itinerary', 'error')
    }
    setEditingItinId(null)
  }

  const deleteItinerary = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return
    try {
      await itinerariesApi.delete(id)
      setItineraries((prev) => prev.filter((i) => i.id !== id))
      addToast('Itinerary deleted', 'success')
    } catch {
      addToast('Failed to delete itinerary', 'error')
    }
  }

  const moveItinerary = async (id: string, folderId: string | null) => {
    try {
      const { data } = await itinerariesApi.update(id, { folder_id: folderId ?? undefined })
      setItineraries((prev) => prev.map((i) => (i.id === id ? data : i)))
    } catch {
      addToast('Failed to move itinerary', 'error')
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const filteredItineraries = selectedFolder
    ? itineraries.filter((i) => i.folder_id === selectedFolder)
    : itineraries

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top nav */}
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-indigo-700 text-lg">TripSync</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.username}</span>
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700">
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — folders */}
        <aside className="w-56 bg-white border-r p-4 flex flex-col gap-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Folders</p>

          <button
            onClick={() => setSelectedFolder(null)}
            className={`text-left text-sm px-2 py-1 rounded ${!selectedFolder ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            All itineraries
          </button>

          {folders.map((f) => (
            <div key={f.id} className="group flex items-center gap-1">
              {editingFolderId === f.id ? (
                <input
                  autoFocus
                  value={editingFolderName}
                  onChange={(e) => setEditingFolderName(e.target.value)}
                  onBlur={() => renameFolder(f.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') renameFolder(f.id); if (e.key === 'Escape') setEditingFolderId(null) }}
                  className="flex-1 text-sm border rounded px-2 py-0.5 min-w-0"
                />
              ) : (
                <button
                  onClick={() => setSelectedFolder(f.id)}
                  className={`flex-1 text-left text-sm px-2 py-1 rounded truncate ${selectedFolder === f.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  {f.name}
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setEditingFolderId(f.id); setEditingFolderName(f.name) }}
                className="hidden group-hover:block text-gray-400 hover:text-gray-600 text-xs px-0.5"
                title="Rename folder"
              >
                &#9998;
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteFolder(f.id, f.name) }}
                className="hidden group-hover:block text-gray-400 hover:text-red-500 text-xs px-0.5"
                title="Delete folder"
              >
                &#10005;
              </button>
            </div>
          ))}

          <form onSubmit={createFolder} className="flex gap-1 mt-2">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder"
              className="flex-1 border rounded text-xs px-2 py-1 min-w-0"
            />
            <button type="submit" className="text-xs bg-indigo-600 text-white px-2 py-1 rounded">+</button>
          </form>
        </aside>

        {/* Main content — itinerary cards */}
        <main className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">
              {selectedFolder ? folders.find((f) => f.id === selectedFolder)?.name : 'All Itineraries'}
            </h2>
          </div>

          {/* Create itinerary form */}
          <form onSubmit={createItinerary} className="flex gap-2 mb-6">
            <input
              value={newItinTitle}
              onChange={(e) => setNewItinTitle(e.target.value)}
              placeholder="New itinerary title..."
              className="border rounded px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700">
              Create
            </button>
          </form>

          {/* Itinerary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItineraries.map((itin) => (
              <div
                key={itin.id}
                className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow group relative"
              >
                {/* Title — click to edit or navigate */}
                {editingItinId === itin.id ? (
                  <input
                    autoFocus
                    value={editingItinTitle}
                    onChange={(e) => setEditingItinTitle(e.target.value)}
                    onBlur={() => renameItinerary(itin.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameItinerary(itin.id); if (e.key === 'Escape') setEditingItinId(null) }}
                    className="font-semibold text-gray-800 w-full border-b border-indigo-300 outline-none bg-transparent"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <p
                    onClick={() => navigate(`/itineraries/${itin.id}`)}
                    className="font-semibold text-gray-800 truncate cursor-pointer"
                  >
                    {itin.title}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  Updated {format(new Date(itin.updated_at), 'MMM d, yyyy')}
                </p>

                {/* Action buttons — hover to show */}
                <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingItinId(itin.id); setEditingItinTitle(itin.title) }}
                    className="text-xs text-gray-400 hover:text-gray-600 p-1"
                    title="Rename"
                  >
                    &#9998;
                  </button>
                  {/* Move to folder */}
                  <select
                    value={itin.folder_id ?? ''}
                    onChange={(e) => { e.stopPropagation(); moveItinerary(itin.id, e.target.value || null) }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs border rounded px-1 py-0.5 text-gray-500 max-w-[80px]"
                    title="Move to folder"
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteItinerary(itin.id, itin.title) }}
                    className="text-xs text-gray-400 hover:text-red-500 p-1"
                    title="Delete"
                  >
                    &#10005;
                  </button>
                </div>
              </div>
            ))}
            {filteredItineraries.length === 0 && (
              <p className="text-sm text-gray-400">No itineraries yet. Create one above.</p>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
