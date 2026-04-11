import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ItineraryEditor from './pages/ItineraryEditor'
import ItineraryView from './pages/ItineraryView'
import JoinPage from './pages/JoinPage'
import Toast from './components/common/Toast'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const initAuth = useAuthStore((s) => s.initAuth)
  const authReady = useAuthStore((s) => s.authReady)

  useEffect(() => {
    initAuth()
  }, [initAuth])

  if (!authReady) return null

  return (
    <BrowserRouter>
      <Toast />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/itineraries/:id"
          element={
            <RequireAuth>
              <ItineraryEditor />
            </RequireAuth>
          }
        />
        <Route path="/itineraries/:id/view" element={<ItineraryView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
