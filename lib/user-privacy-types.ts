export const USER_PRIVACY_KEYS = [
  'showCheckInHistory',
  'showCheckInMessages',
  'showPosts',
  'showComments',
  'showConcertHistory',
  'showActivityHistory',
  'showBadgeHistory',
  'showRatings',
] as const

export type UserPrivacyKey = typeof USER_PRIVACY_KEYS[number]
export type UserPrivacySettings = Record<UserPrivacyKey, boolean>

export const DEFAULT_USER_PRIVACY_SETTINGS: UserPrivacySettings = {
  showCheckInHistory: true,
  showCheckInMessages: true,
  showPosts: true,
  showComments: true,
  showConcertHistory: true,
  showActivityHistory: true,
  showBadgeHistory: true,
  showRatings: true,
}

export type PublicProfileModuleKey = 'posts' | 'replies' | 'recent-messages' | 'achievements' | 'badges' | 'albums' | 'favorites'

export const PUBLIC_PROFILE_MODULE_KEYS: readonly PublicProfileModuleKey[] = [
  'posts',
  'replies',
  'recent-messages',
  'achievements',
  'badges',
  'albums',
  'favorites',
]

const PROFILE_MODULE_PRIVACY_KEY: Record<PublicProfileModuleKey, UserPrivacyKey | null> = {
  posts: 'showPosts',
  replies: 'showComments',
  'recent-messages': 'showCheckInMessages',
  achievements: 'showBadgeHistory',
  badges: 'showBadgeHistory',
  albums: null,
  favorites: null,
}

export function normalizeUserPrivacySettings(row: Partial<UserPrivacySettings> | null | undefined): UserPrivacySettings {
  const settings = { ...DEFAULT_USER_PRIVACY_SETTINGS }
  for (const key of USER_PRIVACY_KEYS) {
    if (typeof row?.[key] === 'boolean') settings[key] = row[key] as boolean
  }
  return settings
}

export function isProfileSectionVisible(settings: UserPrivacySettings, key: UserPrivacyKey, isSelf: boolean) {
  return isSelf || settings[key]
}

export function isProfileModuleVisible(settings: UserPrivacySettings, moduleKey: PublicProfileModuleKey, isSelf: boolean) {
  const privacyKey = PROFILE_MODULE_PRIVACY_KEY[moduleKey]
  return !privacyKey || isProfileSectionVisible(settings, privacyKey, isSelf)
}

export function getVisibleProfileModules(settings: UserPrivacySettings, isSelf: boolean): PublicProfileModuleKey[] {
  return PUBLIC_PROFILE_MODULE_KEYS.filter((moduleKey) => isProfileModuleVisible(settings, moduleKey, isSelf))
}
