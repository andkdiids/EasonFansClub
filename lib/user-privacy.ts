import { prisma } from '@/lib/prisma'
import { DEFAULT_USER_PRIVACY_SETTINGS, normalizeUserPrivacySettings } from '@/lib/user-privacy-types'

export * from '@/lib/user-privacy-types'

export const USER_PRIVACY_SELECT = {
  showCheckInHistory: true,
  showCheckInMessages: true,
  showPosts: true,
  showComments: true,
  showConcertHistory: true,
  showActivityHistory: true,
  showBadgeHistory: true,
  showRatings: true,
} as const

const HIDDEN_USER_PRIVACY_SETTINGS = {
  showCheckInHistory: false,
  showCheckInMessages: false,
  showPosts: false,
  showComments: false,
  showConcertHistory: false,
  showActivityHistory: false,
  showBadgeHistory: false,
  showRatings: false,
}

function isPrivacyTableMissing(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  return code === 'P2021' || /UserPrivacySetting.*(does not exist|not exist)/i.test(message)
}

export async function getUserPrivacySettings(userId: string) {
  const row = await prisma.userPrivacySetting.findUnique({ where: { userId }, select: USER_PRIVACY_SELECT })
  return normalizeUserPrivacySettings(row)
}

/**
 * Public profile reads fail closed when the privacy table is temporarily unavailable.
 * Self reads retain the historical all-visible behavior so a settings migration outage
 * cannot make the owner lose access to their own profile.
 */
export async function getProfileVisibility(userId: string, viewerId?: string | null) {
  const isSelf = Boolean(viewerId && viewerId === userId)
  try {
    return { isSelf, settings: await getUserPrivacySettings(userId), available: true }
  } catch (error) {
    console.error('[user-privacy.read]', { userId, viewerId: viewerId || null, error })
    return {
      isSelf,
      settings: isSelf || isPrivacyTableMissing(error) ? DEFAULT_USER_PRIVACY_SETTINGS : HIDDEN_USER_PRIVACY_SETTINGS,
      available: false,
    }
  }
}
