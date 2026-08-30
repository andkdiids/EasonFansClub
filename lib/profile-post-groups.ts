export const PROFILE_POST_GROUP_UNGROUPED = '__ungrouped__'
export const MAX_PROFILE_POST_GROUPS = 20
export const MAX_PROFILE_POST_GROUP_NAME_LENGTH = 20

export type ProfilePostGroupView = {
  id: string
  name: string
  sortOrder: number
}

export function normalizeProfilePostGroupName(value: unknown) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > MAX_PROFILE_POST_GROUP_NAME_LENGTH) return null
  return name
}

export function isProfilePostGroupDirection(value: unknown): value is 'up' | 'down' {
  return value === 'up' || value === 'down'
}
