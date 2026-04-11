import axios from 'axios'
import type {
  User, Folder, Itinerary, ItineraryDetail, DayWithItems, Item,
  PatchItemResponse, Alternative, Member, VersionListItem, MapPin
} from '../types'

const api = axios.create({
  baseURL: '/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const refreshToken = localStorage.getItem('refresh_token')
      if (refreshToken) {
        try {
          const { data } = await axios.post('/v1/auth/refresh', { refresh_token: refreshToken })
          localStorage.setItem('access_token', data.access_token)
          original.headers.Authorization = `Bearer ${data.access_token}`
          return api(original)
        } catch {
          forceLogout()
          return new Promise(() => {}) // prevent rejected promise from propagating
        }
      } else {
        forceLogout()
        return new Promise(() => {}) // prevent rejected promise from propagating
      }
    }
    return Promise.reject(error)
  }
)

/** Clear all auth state and redirect to login */
function forceLogout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
  window.location.href = '/login'
}

export default api

export const authApi = {
  register: (email: string, username: string, password: string) =>
    api.post<{ user: User; access_token: string; refresh_token: string }>('/auth/register', { email, username, password }),
  login: (email: string, password: string) =>
    api.post<{ user: User; access_token: string; refresh_token: string }>('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  completeOnboarding: () => api.patch('/auth/me/onboarding-complete'),
}

export const foldersApi = {
  list: () => api.get<Folder[]>('/folders'),
  create: (name: string) => api.post<Folder>('/folders', { name }),
  update: (id: string, name: string) => api.patch<Folder>(`/folders/${id}`, { name }),
  delete: (id: string) => api.delete(`/folders/${id}`),
}

export const itinerariesApi = {
  list: () => api.get<Itinerary[]>('/itineraries'),
  create: (title: string, folder_id?: string) =>
    api.post<Itinerary>('/itineraries', { title, folder_id }),
  get: (id: string) => api.get<ItineraryDetail>(`/itineraries/${id}`),
  update: (id: string, data: { title?: string; folder_id?: string }) =>
    api.patch<Itinerary>(`/itineraries/${id}`, data),
  delete: (id: string) => api.delete(`/itineraries/${id}`),
  createDay: (itinId: string, date: string, day_order: number) =>
    api.post<DayWithItems>(`/itineraries/${itinId}/days`, { date, day_order }),
  updateDay: (itinId: string, dayId: string, data: Partial<DayWithItems>) =>
    api.patch<DayWithItems>(`/itineraries/${itinId}/days/${dayId}`, data),
  deleteDay: (itinId: string, dayId: string) =>
    api.delete(`/itineraries/${itinId}/days/${dayId}`),
  createItem: (itinId: string, dayId: string, data: Partial<Item>) =>
    api.post<Item>(`/itineraries/${itinId}/days/${dayId}/items`, data),
  patchItem: (
    itinId: string,
    itemId: string,
    changes: { field: string; value: unknown; based_on_updated_at: string }[],
    save_version = true
  ) => api.patch<PatchItemResponse>(`/itineraries/${itinId}/items/${itemId}`, { changes, save_version }),
  deleteItem: (itinId: string, itemId: string) =>
    api.delete(`/itineraries/${itinId}/items/${itemId}`),
  reorderItem: (itinId: string, itemId: string, day_id: string, new_order: number) =>
    api.patch<Item>(`/itineraries/${itinId}/items/${itemId}/reorder`, { day_id, new_order }),
  exportPDF: (id: string) => api.post(`/itineraries/${id}/export/pdf`, {}, { responseType: 'blob' }),
  exportEmail: (id: string, to: string) => api.post(`/itineraries/${id}/export/email`, { to }),
}

export const alternativesApi = {
  listAll: (itinId: string) =>
    api.get<Alternative[]>(`/itineraries/${itinId}/alternatives`),
  list: (itinId: string, itemId: string, field?: string) =>
    api.get<Alternative[]>(`/itineraries/${itinId}/items/${itemId}/alternatives`, {
      params: field ? { field } : undefined,
    }),
  create: (itinId: string, itemId: string, field_name: string, value: string) =>
    api.post<Alternative>(`/itineraries/${itinId}/items/${itemId}/alternatives`, { field_name, value }),
  dismiss: (itinId: string, itemId: string, altId: string) =>
    api.patch<Alternative>(`/itineraries/${itinId}/items/${itemId}/alternatives/${altId}`, { is_active: false }),
  adopt: (itinId: string, itemId: string, altId: string) =>
    api.post<PatchItemResponse>(`/itineraries/${itinId}/items/${itemId}/alternatives/${altId}/adopt`),
}

export const membersApi = {
  list: (itinId: string) => api.get<Member[]>(`/itineraries/${itinId}/members`),
  updateRole: (itinId: string, userId: string, role: string) =>
    api.patch<Member>(`/itineraries/${itinId}/members/${userId}`, { role }),
  remove: (itinId: string, userId: string) =>
    api.delete(`/itineraries/${itinId}/members/${userId}`),
}

export const sharingApi = {
  createLink: (itinId: string, role: string) =>
    api.post<{ token: string; url: string; role: string }>(`/itineraries/${itinId}/share-links`, { role }),
  preview: (token: string) =>
    api.get<{ itinerary_id: string; role: string; itinerary_title: string }>(`/join/${token}`),
  join: (token: string) =>
    api.post<{ itinerary_id: string; role: string; itinerary_title: string; message: string }>(`/join/${token}`),
}

export const mapPinsApi = {
  list: (itinId: string) => api.get<MapPin[]>(`/itineraries/${itinId}/map-pins`),
  create: (itinId: string, label: string | undefined, lat: number, lng: number) =>
    api.post<MapPin>(`/itineraries/${itinId}/map-pins`, { label, lat, lng }),
  delete: (itinId: string, pinId: string) =>
    api.delete(`/itineraries/${itinId}/map-pins/${pinId}`),
}

export const versionsApi = {
  list: (itinId: string, page = 1, per_page = 20) =>
    api.get<VersionListItem[]>(`/itineraries/${itinId}/versions`, { params: { page, per_page } }),
  rollback: (itinId: string, versionNum: number) =>
    api.post<{ new_version_num: number; message: string }>(`/itineraries/${itinId}/versions/${versionNum}/rollback`),
}
