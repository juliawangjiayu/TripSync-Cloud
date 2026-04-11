import { useCallback, useRef } from 'react'
import { useUIStore } from '../../stores/uiStore'
import MapPanel from '../panels/MapPanel'
import AIChatPanel from '../panels/AIChatPanel'

interface RightPanelProps {
  itineraryId: string
  readOnly?: boolean
}

export default function RightPanel({ itineraryId, readOnly = false }: RightPanelProps) {
  const { rightPanel, setRightPanel, rightPanelOpen, setRightPanelOpen, rightPanelWidth, setRightPanelWidth } = useUIStore()
  const dragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true

    const startX = e.clientX
    const startWidth = rightPanelWidth

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      // Dragging left increases width
      const delta = startX - ev.clientX
      setRightPanelWidth(startWidth + delta)
    }

    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [rightPanelWidth, setRightPanelWidth])

  if (!rightPanelOpen) {
    return (
      <aside className="w-8 border-l bg-white shrink-0 flex flex-col items-center pt-2">
        <button
          onClick={() => setRightPanelOpen(true)}
          className="text-gray-400 hover:text-gray-600 text-xs"
          title="Expand panel"
        >
          &#x25C0;
        </button>
      </aside>
    )
  }

  return (
    <aside className="border-l bg-white flex shrink-0" style={{ width: rightPanelWidth }}>
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize hover:bg-indigo-300 active:bg-indigo-400 transition-colors"
      />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Tab selector + collapse button */}
        <div data-tour="right-panel-tabs" className="flex border-b items-center">
          {(['map', 'chat'] as const).map((panel) => (
            <button
              key={panel}
              onClick={() => setRightPanel(rightPanel === panel ? null : panel)}
              className={`flex-1 py-2 text-xs font-medium capitalize ${
                rightPanel === panel
                  ? 'border-b-2 border-indigo-600 text-indigo-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {panel === 'map' ? 'Map' : 'AI Chat'}
            </button>
          ))}
          <button
            onClick={() => setRightPanelOpen(false)}
            className="px-2 text-gray-400 hover:text-gray-600 text-xs"
            title="Collapse panel"
          >
            &#x25B6;
          </button>
        </div>

        {/* Panel content — keep both mounted, toggle visibility via CSS to preserve state */}
        <div className="flex-1 overflow-hidden relative">
          <div className={`absolute inset-0 ${rightPanel === 'map' ? '' : 'invisible'}`}>
            <MapPanel itineraryId={itineraryId} readOnly={readOnly} />
          </div>
          <div className={`absolute inset-0 ${rightPanel === 'chat' ? '' : 'invisible'}`}>
            <AIChatPanel itineraryId={itineraryId} />
          </div>
          {rightPanel === null && (
            <div className="flex items-center justify-center h-full text-gray-300 text-sm">
              Select a panel above
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
