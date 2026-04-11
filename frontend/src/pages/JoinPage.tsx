import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { sharingApi } from '../api/client'
import { useAuthStore } from '../stores/authStore'

export default function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<{ itinerary_id: string; role: string; itinerary_title: string } | null>(null)
  const [error, setError] = useState('')
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  useEffect(() => {
    if (!token) return
    sharingApi.preview(token).then(({ data }) => setInfo(data)).catch(() => setError('Invalid or expired link'))
  }, [token])

  const handleJoin = async () => {
    if (!token) return
    if (!user) {
      navigate(`/login?redirect=/join/${token}`)
      return
    }
    const { data } = await sharingApi.join(token)
    navigate(`/itineraries/${data.itinerary_id}`)
  }

  if (error) return <div className="flex items-center justify-center h-screen text-red-500">{error}</div>
  if (!info) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-sm text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-2">{info.itinerary_title}</h2>
        <p className="text-sm text-gray-500 mb-6">
          You're invited as <strong>{info.role}</strong>
        </p>
        <button
          onClick={handleJoin}
          className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-indigo-700"
        >
          {user ? 'Join Itinerary' : 'Sign in to Join'}
        </button>
      </div>
    </div>
  )
}
