import { useState } from 'react'
import Modal from './Modal'
import { useUIStore } from '../../stores/uiStore'
import { sharingApi } from '../../api/client'

interface ShareLinksModalProps {
  itineraryId: string
}

interface GeneratedLink {
  role: string
  url: string
}

export default function ShareLinksModal({ itineraryId }: ShareLinksModalProps) {
  const { shareModalOpen, setShareModalOpen, setMembersModalOpen, addToast } = useUIStore()
  const [selectedRole, setSelectedRole] = useState<'editor' | 'viewer'>('editor')
  const [links, setLinks] = useState<GeneratedLink[]>([])
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const { data } = await sharingApi.createLink(itineraryId, selectedRole)
      setLinks((prev) => [{ role: data.role, url: data.url }, ...prev])
    } catch {
      addToast('Failed to create share link', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      addToast('Link copied to clipboard', 'success')
    } catch {
      addToast('Failed to copy', 'error')
    }
  }

  const handleOpenMembers = () => {
    setShareModalOpen(false)
    setMembersModalOpen(true)
  }

  const handleClose = () => {
    setShareModalOpen(false)
    setLinks([])
  }

  return (
    <Modal open={shareModalOpen} onClose={handleClose} title="Share Itinerary">
      {/* Role selector */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 mb-2">Invite as:</p>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedRole('editor')}
            className={`flex-1 text-sm py-1.5 rounded border ${
              selectedRole === 'editor'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setSelectedRole('viewer')}
            className={`flex-1 text-sm py-1.5 rounded border ${
              selectedRole === 'viewer'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Viewer
          </button>
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="w-full text-sm bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700 disabled:opacity-40 mb-4"
      >
        {generating ? 'Generating...' : 'Generate Link'}
      </button>

      {/* Generated links */}
      {links.length > 0 && (
        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {links.map((link, i) => (
            <div key={i} className="flex items-center gap-2 border rounded px-2 py-1.5">
              <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                link.role === 'editor' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {link.role}
              </span>
              <input
                readOnly
                value={link.url}
                className="flex-1 text-xs text-gray-600 bg-transparent outline-none truncate"
              />
              <button
                onClick={() => handleCopy(link.url)}
                className="text-xs text-indigo-600 hover:text-indigo-800 shrink-0"
              >
                Copy
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Members link */}
      <button
        onClick={handleOpenMembers}
        className="w-full text-xs text-gray-500 hover:text-gray-700 py-1"
      >
        View members &rarr;
      </button>
    </Modal>
  )
}
