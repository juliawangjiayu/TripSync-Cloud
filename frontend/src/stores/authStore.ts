import axios from 'axios'
import { create } from 'zustand'
import { authApi } from '../api/client'
import type { User } from '../types'

interface AuthStore {
  user: User | null
  accessToken: string | null
  isLoading: boolean
  authReady: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  logout: () => void
  /** Initialize auth: load from storage, refresh token if needed, then set authReady */
  initAuth: () => Promise<void>
  markOnboardingComplete: () => void
}

function loadInitialAuth(): { user: User | null; accessToken: string | null } {
  try {
    const token = localStorage.getItem('access_token')
    const refreshToken = localStorage.getItem('refresh_token')
    const userStr = localStorage.getItem('user')
    // User is considered authenticated if user data exists and either token is present
    // (missing access_token will be refreshed automatically by the axios interceptor)
    if (userStr && (token || refreshToken)) {
      return { user: JSON.parse(userStr), accessToken: token }
    }
  } catch { /* ignore */ }
  return { user: null, accessToken: null }
}

const initialAuth = loadInitialAuth()

export const useAuthStore = create<AuthStore>((set) => ({
  user: initialAuth.user,
  accessToken: initialAuth.accessToken,
  isLoading: false,
  authReady: false,

  initAuth: async () => {
    const token = localStorage.getItem('access_token')
    const refreshToken = localStorage.getItem('refresh_token')
    const userStr = localStorage.getItem('user')

    if (!userStr || (!token && !refreshToken)) {
      // No user or no tokens at all — not authenticated
      set({ user: null, accessToken: null, authReady: true })
      return
    }

    if (token) {
      // access_token exists — ready immediately
      set({ user: JSON.parse(userStr), accessToken: token, authReady: true })
      return
    }

    // access_token missing but refresh_token exists — try to refresh
    try {
      const { data } = await axios.post('/v1/auth/refresh', { refresh_token: refreshToken })
      localStorage.setItem('access_token', data.access_token)
      set({ user: JSON.parse(userStr), accessToken: data.access_token, authReady: true })
    } catch {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('user')
      set({ user: null, accessToken: null, authReady: true })
    }
  },

  login: async (email, password) => {
    set({ isLoading: true })
    try {
      const { data } = await authApi.login(email, password)
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      set({ user: data.user, accessToken: data.access_token, isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  register: async (email, username, password) => {
    set({ isLoading: true })
    try {
      const { data } = await authApi.register(email, username, password)
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      set({ user: data.user, accessToken: data.access_token, isLoading: false })
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    set({ user: null, accessToken: null })
  },

  markOnboardingComplete: () => {
    set((state) => {
      const updatedUser = state.user ? { ...state.user, has_completed_onboarding: true } : null
      if (updatedUser) {
        localStorage.setItem('user', JSON.stringify(updatedUser))
      }
      return { user: updatedUser }
    })
  },
}))
