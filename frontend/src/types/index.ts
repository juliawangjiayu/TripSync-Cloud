export interface User {
  id: string
  email: string
  username: string
  has_completed_onboarding: boolean
}

export interface Folder {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface Itinerary {
  id: string
  title: string
  folder_id: string | null
  owner_id: string
  created_at: string
  updated_at: string
}

export interface ItineraryDetail extends Itinerary {
  days: DayWithItems[]
  my_role: 'viewer' | 'editor'
}

export interface DayWithItems {
  id: string
  itinerary_id: string
  date: string
  day_order: number
  is_collapsed: boolean
  items: Item[]
}

export interface Item {
  id: string
  day_id: string
  item_order: number
  time_start: string | null
  time_end: string | null
  spot_name: string | null
  activity_desc: string | null
  transport: string | null
  estimated_cost: number | null
  booking_status: string | null
  booking_url: string | null
  notes: string | null
  rating: number | null
  time_updated_at: string
  spot_updated_at: string
  activity_updated_at: string
  transport_updated_at: string
  cost_updated_at: string
  booking_status_updated_at: string
  booking_url_updated_at: string
  notes_updated_at: string
  rating_updated_at: string
  last_modified_by: string | null
}

export type LockableField =
  | 'time_start' | 'time_end' | 'spot_name' | 'activity_desc'
  | 'transport' | 'estimated_cost' | 'booking_status' | 'booking_url'
  | 'notes' | 'rating'

export const FIELD_TO_TS: Record<LockableField, keyof Item> = {
  time_start: 'time_updated_at',
  time_end: 'time_updated_at',
  spot_name: 'spot_updated_at',
  activity_desc: 'activity_updated_at',
  transport: 'transport_updated_at',
  estimated_cost: 'cost_updated_at',
  booking_status: 'booking_status_updated_at',
  booking_url: 'booking_url_updated_at',
  notes: 'notes_updated_at',
  rating: 'rating_updated_at',
}

export interface Alternative {
  id: string
  item_id: string
  field_name: string
  value: string
  proposed_by: string
  created_at: string
  is_active: boolean
}

export interface ConflictedFieldInfo {
  field: string
  current_value: string | number | boolean | null
  updated_at: string
}

export interface PatchItemResponse {
  accepted: string[]
  conflicted: string[]
  conflicted_fields: ConflictedFieldInfo[]
  alternatives_created: Alternative[]
}

export interface Member {
  user_id: string
  username: string
  email: string
  role: 'viewer' | 'editor'
  joined_at: string
  invited_via: string | null
}

export interface ChangeSummary {
  edits: number
  creates: number
  deletes: number
  reorders: number
}

export interface VersionListItem {
  id: string
  version_num: number
  entry_type: string
  author_id: string | null
  created_at: string
  change_count: number
  change_summary: ChangeSummary
}

export interface MapPin {
  id: string
  itinerary_id: string
  label: string | null
  lat: number
  lng: number
  created_by: string
  created_at: string
}
