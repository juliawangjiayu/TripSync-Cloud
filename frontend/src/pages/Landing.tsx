import { useNavigate } from 'react-router-dom'

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-indigo-50 cursor-pointer"
      onClick={() => navigate('/login')}
    >
      <h1 className="text-5xl font-bold text-indigo-700 mb-4">TripSync</h1>
      <p className="text-lg text-gray-500">Collaborative travel planning for groups</p>
      <p className="mt-8 text-sm text-gray-400">Click anywhere to get started</p>
    </div>
  )
}
