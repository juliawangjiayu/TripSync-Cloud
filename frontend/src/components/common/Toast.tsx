import { useUIStore } from '../../stores/uiStore'

export default function Toast() {
  const { toasts, removeToast } = useUIStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => removeToast(toast.id)}
          className={`cursor-pointer rounded px-4 py-2 text-white text-sm shadow-lg transition-all
            ${toast.type === 'error' ? 'bg-red-600' : toast.type === 'warning' ? 'bg-amber-500' : toast.type === 'success' ? 'bg-green-600' : 'bg-gray-800'}
          `}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
