import { prisma } from '@/lib/prisma'
import { normalizeProfileRecordPreferences, type ProfileRecordPreference } from '@/lib/profile-record-sections'

const PROFILE_RECORD_PREFERENCE_SELECT = {
  section: true,
  sortOrder: true,
  isVisible: true,
} as const

export async function getProfileRecordPreferences(userId: string): Promise<ProfileRecordPreference[]> {
  const rows = await prisma.profileRecordPreference.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { section: 'asc' }],
    select: PROFILE_RECORD_PREFERENCE_SELECT,
  })
  return normalizeProfileRecordPreferences(rows)
}

/** SSR fallback for historical users and for a temporarily unavailable preference table. */
export async function getProfileRecordPreferencesSafe(userId: string): Promise<ProfileRecordPreference[]> {
  try {
    return await getProfileRecordPreferences(userId)
  } catch (error) {
    console.error('[profile-record-preferences.read]', { userId, error })
    return normalizeProfileRecordPreferences([])
  }
}
