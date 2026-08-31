import type { UserPrivacyKey } from '@/lib/user-privacy-types'

export type ProfileRecordSectionDefinition = {
  key: string
  selfLabel: string
  otherLabel: string
  defaultOrder: number
  privacyKey: UserPrivacyKey | null
}

/**
 * The single source of truth for record tabs on both the owner and public
 * profile. The profile wall is deliberately not part of this list: its
 * position is fixed after the whole record area.
 */
export const PROFILE_RECORD_SECTIONS = [
  { key: 'posts', selfLabel: '发帖记录', otherLabel: '发帖记录', defaultOrder: 1, privacyKey: 'showPosts' },
  { key: 'replies', selfLabel: '回复记录', otherLabel: '回复记录', defaultOrder: 2, privacyKey: 'showComments' },
  { key: 'recent-messages', selfLabel: '最近留言', otherLabel: '最近留言', defaultOrder: 3, privacyKey: 'showCheckInMessages' },
  { key: 'salon', selfLabel: '沙龙', otherLabel: 'TA 的沙龙', defaultOrder: 4, privacyKey: 'showSalon' },
  { key: 'achievements', selfLabel: '我的成就', otherLabel: 'TA 的成就', defaultOrder: 5, privacyKey: 'showBadgeHistory' },
  { key: 'badges', selfLabel: '我的勋章', otherLabel: 'TA 的勋章', defaultOrder: 6, privacyKey: 'showBadgeHistory' },
  { key: 'albums', selfLabel: '我的专辑', otherLabel: 'TA 的专辑', defaultOrder: 7, privacyKey: null },
  { key: 'favorites', selfLabel: '我的收藏', otherLabel: 'TA 的收藏', defaultOrder: 8, privacyKey: null },
] as const satisfies readonly ProfileRecordSectionDefinition[]

export type ProfileRecordSectionKey = typeof PROFILE_RECORD_SECTIONS[number]['key']

export const PROFILE_RECORD_SECTION_KEYS = PROFILE_RECORD_SECTIONS.map((section) => section.key) as readonly ProfileRecordSectionKey[]

export type ProfileRecordPreference = {
  key: ProfileRecordSectionKey
  order: number
  visible: boolean
}

export type ProfileRecordPreferenceRow = {
  section: string
  sortOrder: number
  isVisible: boolean
}

export function isProfileRecordSectionKey(value: unknown): value is ProfileRecordSectionKey {
  return typeof value === 'string' && (PROFILE_RECORD_SECTION_KEYS as readonly string[]).includes(value)
}

export function getProfileRecordSection(key: ProfileRecordSectionKey) {
  return PROFILE_RECORD_SECTIONS.find((section) => section.key === key) || PROFILE_RECORD_SECTIONS[0]
}

/**
 * Missing rows intentionally fall back to the product default. This keeps
 * existing users visible while allowing preferences to be introduced lazily.
 */
export function normalizeProfileRecordPreferences(rows: readonly ProfileRecordPreferenceRow[] | null | undefined): ProfileRecordPreference[] {
  const rowBySection = new Map<string, ProfileRecordPreferenceRow>()
  for (const row of rows || []) {
    if (isProfileRecordSectionKey(row.section) && !rowBySection.has(row.section)) rowBySection.set(row.section, row)
  }

  return PROFILE_RECORD_SECTIONS
    .map((section) => {
      const row = rowBySection.get(section.key)
      const order = row && Number.isInteger(row.sortOrder) ? row.sortOrder : section.defaultOrder
      return {
        key: section.key,
        order,
        visible: row?.isVisible !== false,
        defaultOrder: section.defaultOrder,
      }
    })
    .sort((left, right) => left.order - right.order || left.defaultOrder - right.defaultOrder || left.key.localeCompare(right.key))
    .map(({ key, visible }, index) => ({ key, visible, order: index + 1 }))
}

export function getOrderedProfileRecordSectionKeys(preferences: readonly ProfileRecordPreference[], includeHidden = false) {
  return preferences
    .filter((preference) => includeHidden || preference.visible)
    .sort((left, right) => left.order - right.order)
    .map((preference) => preference.key)
}

export function getProfileRecordLabel(key: ProfileRecordSectionKey, isSelf: boolean) {
  const section = getProfileRecordSection(key)
  return isSelf ? section.selfLabel : section.otherLabel
}
