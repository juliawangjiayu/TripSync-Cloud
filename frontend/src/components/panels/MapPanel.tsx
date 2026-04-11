import { useEffect, useRef, useState } from 'react'
import { mapPinsApi } from '../../api/client'
import type { MapPin } from '../../types'

declare global {
  interface Window {
    google: typeof google
    initMap: () => void
  }
}

interface MapPanelProps {
  itineraryId: string
  readOnly?: boolean
}

export default function MapPanel({ itineraryId, readOnly = false }: MapPanelProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const [pins, setPins] = useState<MapPin[]>([])
  const [hiddenPins, setHiddenPins] = useState<Set<string>>(new Set())
  const [labelInput, setLabelInput] = useState('')
  const [pendingLatLng, setPendingLatLng] = useState<{ lat: number; lng: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const previewMarkerRef = useRef<google.maps.Marker | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Load pins from backend
  useEffect(() => {
    mapPinsApi.list(itineraryId).then(({ data }) => setPins(data))
  }, [itineraryId])

  // Load Google Maps script + init map (once)
  useEffect(() => {
    if (!window.google) {
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY
      if (!apiKey) {
        console.warn('VITE_GOOGLE_MAPS_KEY is not set – Map panel will not load.')
        return
      }
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
      script.async = true
      document.head.appendChild(script)
    }

    const waitForMaps = setInterval(() => {
      if (window.google && mapRef.current && !mapInstance.current) {
        clearInterval(waitForMaps)
        mapInstance.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: 1.3521, lng: 103.8198 },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
        })

        if (!readOnly) {
          mapInstance.current.addListener('click', (e: google.maps.MapMouseEvent) => {
            if (e.latLng) {
              setPendingLatLng({ lat: e.latLng.lat(), lng: e.latLng.lng() })
            }
          })
        }

        setMapReady(true)
      }
    }, 200)
    return () => clearInterval(waitForMaps)
  }, [readOnly])

  // Sync markers with pins + hiddenPins
  useEffect(() => {
    if (!mapReady || !mapInstance.current) return

    const currentIds = new Set(pins.map((p) => p.id))

    // Remove markers for deleted pins
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.setMap(null)
        markersRef.current.delete(id)
      }
    })

    // Add/update markers
    pins.forEach((pin) => {
      const isHidden = hiddenPins.has(pin.id)
      let marker = markersRef.current.get(pin.id)

      if (!marker) {
        marker = new window.google.maps.Marker({
          position: { lat: pin.lat, lng: pin.lng },
          map: isHidden ? null : mapInstance.current!,
          title: pin.label ?? '',
        })
        markersRef.current.set(pin.id, marker)
      } else {
        marker.setMap(isHidden ? null : mapInstance.current!)
      }
    })
  }, [pins, hiddenPins, mapReady])

  // Fit map bounds to visible pins when pins change
  useEffect(() => {
    if (!mapReady || !mapInstance.current) return
    const visiblePins = pins.filter((p) => !hiddenPins.has(p.id))
    if (visiblePins.length === 0) return

    if (visiblePins.length === 1) {
      mapInstance.current.setCenter({ lat: visiblePins[0].lat, lng: visiblePins[0].lng })
      mapInstance.current.setZoom(14)
    } else {
      const bounds = new window.google.maps.LatLngBounds()
      visiblePins.forEach((pin) => bounds.extend({ lat: pin.lat, lng: pin.lng }))
      mapInstance.current.fitBounds(bounds, 40)
    }
  }, [pins.length, mapReady]) // Only re-fit when pins are added/removed, not on visibility toggle

  // Set up Places Autocomplete when map is ready
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !searchRef.current || readOnly) return
    const autocomplete = new window.google.maps.places.Autocomplete(searchRef.current, {
      fields: ['geometry', 'name', 'formatted_address'],
    })
    autocomplete.bindTo('bounds', mapInstance.current)
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place.geometry?.location) return
      const loc = place.geometry.location
      mapInstance.current!.setCenter(loc)
      mapInstance.current!.setZoom(15)
      setPendingLatLng({ lat: loc.lat(), lng: loc.lng() })
      setLabelInput(place.name || place.formatted_address || '')
    })
  }, [mapReady, readOnly])

  // Show/move/remove preview marker when pendingLatLng changes
  useEffect(() => {
    if (!mapReady || !mapInstance.current) return
    if (pendingLatLng) {
      if (previewMarkerRef.current) {
        previewMarkerRef.current.setPosition(pendingLatLng)
      } else {
        previewMarkerRef.current = new window.google.maps.Marker({
          position: pendingLatLng,
          map: mapInstance.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#4f46e5',
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          zIndex: 999,
        })
      }
    } else if (previewMarkerRef.current) {
      previewMarkerRef.current.setMap(null)
      previewMarkerRef.current = null
    }
  }, [pendingLatLng, mapReady])

  const handleConfirmPin = async () => {
    if (!pendingLatLng) return
    try {
      const { data } = await mapPinsApi.create(itineraryId, labelInput || undefined, pendingLatLng.lat, pendingLatLng.lng)
      setPins((prev) => [...prev, data])
      setPendingLatLng(null)
      setLabelInput('')
    } catch {
      // silently handle
    }
  }

  const handleDeletePin = async (pinId: string) => {
    try {
      await mapPinsApi.delete(itineraryId, pinId)
      setPins((prev) => prev.filter((p) => p.id !== pinId))
      setHiddenPins((prev) => {
        const next = new Set(prev)
        next.delete(pinId)
        return next
      })
    } catch {
      // silently handle
    }
  }

  const togglePinVisibility = (pinId: string) => {
    setHiddenPins((prev) => {
      const next = new Set(prev)
      if (next.has(pinId)) {
        next.delete(pinId)
      } else {
        next.add(pinId)
      }
      return next
    })
  }

  const focusPin = (pin: MapPin) => {
    if (!mapInstance.current) return
    if (hiddenPins.has(pin.id)) {
      togglePinVisibility(pin.id)
    }
    mapInstance.current.setCenter({ lat: pin.lat, lng: pin.lng })
    mapInstance.current.setZoom(15)
  }

  return (
    <div className="flex h-full">
      {/* Pin management sidebar */}
      {sidebarOpen && (
        <div className="w-48 border-r bg-gray-50 flex flex-col shrink-0">
          <div className="px-2 py-1.5 border-b bg-white flex items-center justify-between">
            <span className="text-xs font-medium text-gray-700">Pins ({pins.length})</span>
            <button onClick={() => setSidebarOpen(false)} className="text-gray-400 hover:text-gray-600 text-xs">
              &times;
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {pins.length === 0 && (
              <p className="text-xs text-gray-400 text-center mt-4 px-2">
                Click on the map to add pins
              </p>
            )}
            {pins.map((pin) => {
              const isHidden = hiddenPins.has(pin.id)
              return (
                <div
                  key={pin.id}
                  className={`flex items-center gap-1 px-2 py-1.5 text-xs border-b border-gray-100 hover:bg-white group ${
                    isHidden ? 'opacity-50' : ''
                  }`}
                >
                  {/* Visibility checkbox */}
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => togglePinVisibility(pin.id)}
                    className="shrink-0 accent-indigo-600"
                    title={isHidden ? 'Show pin' : 'Hide pin'}
                  />

                  {/* Label — click to focus */}
                  <button
                    onClick={() => focusPin(pin)}
                    className="flex-1 text-left truncate text-gray-700 hover:text-indigo-600"
                    title={`Go to: ${pin.label || `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`}`}
                  >
                    {pin.label || `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`}
                  </button>

                  {/* Delete button */}
                  {!readOnly && (
                    <button
                      onClick={() => handleDeletePin(pin.id)}
                      className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                      title="Delete pin"
                    >
                      &times;
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Map area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search bar */}
        {!readOnly && (
          <div className="p-2 border-b flex gap-1">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-xs text-gray-500 hover:text-indigo-600 px-1"
                title="Show pin list"
              >
                &#9776;
              </button>
            )}
            <input
              ref={searchRef}
              placeholder="Search location..."
              className="flex-1 border rounded text-xs px-2 py-1"
            />
          </div>
        )}

        {/* Map */}
        <div ref={mapRef} className="flex-1" />

        {/* Pending pin confirmation */}
        {pendingLatLng && !readOnly && (
          <div className="p-2 border-t bg-yellow-50 flex gap-1 items-center">
            <input
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Pin label (optional)"
              className="flex-1 border rounded text-xs px-2 py-1"
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmPin()}
            />
            <button onClick={handleConfirmPin} className="text-xs bg-green-600 text-white px-2 py-1 rounded">
              Add Pin
            </button>
            <button onClick={() => setPendingLatLng(null)} className="text-xs text-gray-400">x</button>
          </div>
        )}
      </div>
    </div>
  )
}
