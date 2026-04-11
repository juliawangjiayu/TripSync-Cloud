import { useState, useEffect } from 'react'
import Modal from './Modal'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { useItineraryStore } from '../../stores/itineraryStore'
import { membersApi } from '../../api/client'
import type { Member } from '../../types'

interface MembersModalProps {
  itineraryId: string
}

export default function MembersModal({ itineraryId }: MembersModalProps) {
  const { membersModalOpen, setMembersModalOpen, addToast } = useUIStore()
  const { user } = useAuthStore()
  const { itinerary } = useItineraryStore()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)

  const isOwner = user?.id === itinerary?.owner_id

  const fetchMembers = async () => {
    setLoading(true)
    try {
      const { data } = await membersApi.list(itineraryId)
      setMembers(data)
    } catch {
      addToast('Failed to load members', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (membersModalOpen) fetchMembers()
  }, [membersModalOpen])

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await membersApi.updateRole(itineraryId, userId, newRole)
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: newRole as 'viewer' | 'editor' } : m))
      )
      addToast('Role updated', 'success')
    } catch {
      addToast('Failed to update role', 'error')
    }
  }

  const handleRemove = async (userId: string, username: string) => {
    if (!confirm(`Remove ${username} from this itinerary?`)) return
    try {
      await membersApi.remove(itineraryId, userId)
      setMembers((prev) => prev.filter((m) => m.user_id !== userId))
      addToast('Member removed', 'success')
    } catch {
      addToast('Failed to remove member', 'error')
    }
  }

  const roleBadge = (role: string) => {
    if (role === 'editor') return 'bg-green-100 text-green-700'
    return 'bg-gray-100 text-gray-600'
  }

  return (
    <Modal open={membersModalOpen} onClose={() => setMembersModalOpen(false)} title="Members">
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">Loading...</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No members yet</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {members.map((m) => {
            const isSelf = m.user_id === user?.id
            const isOwnerRow = m.user_id === itinerary?.owner_id
            return (
              <div key={m.user_id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{m.username}</span>
                    {isOwnerRow && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">owner</span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${roleBadge(m.role)}`}>
                      {m.role}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                </div>

                {isOwner && !isOwnerRow && !isSelf && (
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                      className="text-xs border rounded px-1 py-0.5"
                    >
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <button
                      onClick={() => handleRemove(m.user_id, m.username)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
