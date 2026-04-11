import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useItineraryStore } from '../stores/itineraryStore'
import TopBar from '../components/layout/TopBar'
import DaySection from '../components/editor/DaySection'

export default function ItineraryView() {
  const { id } = useParams<{ id: string }>()
  const { itinerary, load, isLoading } = useItineraryStore()

  useEffect(() => {
    if (id) load(id)
  }, [id, load])

  if (isLoading || !itinerary || !id) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <TopBar itineraryId={id} readOnly />
      <main className="flex-1 overflow-y-auto p-4">
        {itinerary.days.map((day) => (
          <DaySection key={day.id} day={day} itineraryId={id} readOnly />
        ))}
      </main>
    </div>
  )
}
