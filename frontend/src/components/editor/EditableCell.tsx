import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useDirtyStore } from '../../stores/dirtyStore'
import { useAlternativeStore } from '../../stores/alternativeStore'
import type { LockableField } from '../../types'

import AlternativeDropdown from './AlternativeDropdown'

interface EditableCellProps {
  itineraryId: string
  itemId: string
  field: LockableField
  value: unknown
  basedOnUpdatedAt: string
  type?: 'text' | 'select' | 'number'
  options?: string[]
  readOnly?: boolean
}

export default function EditableCell({
  itineraryId,
  itemId,
  field,
  value,
  basedOnUpdatedAt,
  type = 'text',
  options,
  readOnly = false,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [localValue, setLocalValue] = useState(String(value ?? ''))
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const { setDirty, dirty } = useDirtyStore()
  const alternatives = useAlternativeStore((s) => s.alternatives)
  const [showAlts, setShowAlts] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const dirtyEntry = dirty[itemId]?.[field]
  const isDirty = !!dirtyEntry
  const displayValue = isDirty ? String(dirtyEntry.value ?? '') : String(value ?? '')
  const hasAlts = (alternatives[itemId]?.[field]?.length ?? 0) > 0

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [editing])

  const openAlts = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const anchor = btnRef.current
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) })
    }
    setShowAlts(true)
  }, [])

  const handleBlur = () => {
    setEditing(false)
    if (localValue !== String(value ?? '') && basedOnUpdatedAt) {
      setDirty(itemId, field, localValue || null, basedOnUpdatedAt)
    }
  }

  const cellBg = isDirty
    ? 'bg-yellow-50'
    : 'bg-white hover:bg-gray-50'

  if (readOnly) {
    return (
      <div className="px-2 py-1 text-sm text-gray-700 relative">
        {String(value ?? '')}
        {hasAlts && (
          <span className="absolute top-0 right-0 text-indigo-500 text-xs cursor-pointer"
            onClick={() => setShowAlts(true)}>+</span>
        )}
      </div>
    )
  }

  return (
    <div className={`group flex items-center ${cellBg} min-h-[28px] px-1 py-1`}>
      {/* Alternatives button — inline left of content */}
      {!editing && (
        <button
          ref={btnRef}
          data-tour="alternatives"
          onClick={openAlts}
          className={`shrink-0 w-4 text-xs leading-none ${
            hasAlts ? 'text-indigo-500 hover:text-indigo-700' : 'text-gray-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100'
          }`}
          title="Alternatives"
        >
          {hasAlts ? '★' : '+'}
        </button>
      )}
      {editing && <span className="w-4 shrink-0" />}

      <div className="flex-1 min-w-0">
        {editing ? (
          type === 'select' && options ? (
            <select
              ref={inputRef as React.RefObject<HTMLSelectElement>}
              value={localValue}
              onChange={(e) => {
                const newVal = e.target.value
                setLocalValue(newVal)
                setEditing(false)
                if (newVal !== String(value ?? '') && basedOnUpdatedAt) {
                  setDirty(itemId, field, newVal || null, basedOnUpdatedAt)
                }
              }}
              onBlur={handleBlur}
              className="w-full text-sm border-none outline-none bg-transparent"
            >
              <option value="">--</option>
              {options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type={type === 'number' ? 'number' : 'text'}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
              className="w-full text-sm border-none outline-none bg-transparent"
            />
          )
        ) : (
          <span
            onClick={() => { setLocalValue(displayValue); setEditing(true) }}
            className={`flex items-center text-sm text-gray-800 min-h-[20px] ${type === 'select' ? 'cursor-pointer' : 'cursor-text'}`}
          >
            <span className="flex-1 min-w-0 truncate">{displayValue}</span>
            {type === 'select' && (
              <svg className="w-3.5 h-3.5 shrink-0 ml-1 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            )}
          </span>
        )}
      </div>

      {showAlts && dropdownPos && createPortal(
        <>
          {/* Backdrop to close on outside click */}
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowAlts(false)} />
          <div className="fixed z-[9999]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
            <AlternativeDropdown
              itineraryId={itineraryId}
              itemId={itemId}
              field={field}
              currentValue={String(value ?? '')}
              onClose={() => setShowAlts(false)}
            />
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
