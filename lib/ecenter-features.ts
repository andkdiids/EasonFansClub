import type { IconName } from '@/components/UiIcon'
import { prisma } from '@/lib/prisma'

/**
 * The E院中心 registry is the only source of fixed feature metadata.
 * Database rows may override order and visibility only; they never provide
 * routes, icons, labels, or permissions.
 */
export const ECENTER_FEATURES = [
  { featureKey: 'CREATE_POST', label: '发布帖子', href: '/posts/new', icon: 'forum', title: '发布帖子', defaultSortOrder: 1, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, activePrefixes: ['/posts/new'] },
  { featureKey: 'CHECKIN', label: '每日挂号', href: '/checkin', icon: 'check', title: '每日挂号', defaultSortOrder: 2, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: true, activePrefixes: ['/checkin'] },
  { featureKey: 'DAILY_PRESCRIPTION', label: '每日处方', href: '/games/daily-prescription', icon: 'pill', title: '每日处方', defaultSortOrder: 3, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: true, activePrefixes: ['/games/daily-prescription'] },
  { featureKey: 'ENTERTAINMENT', label: '娱乐天空', href: '/games', icon: 'star', title: '娱乐天空', defaultSortOrder: 4, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, activePrefixes: ['/games', '/entertainment'] },
  { featureKey: 'CLINIC', label: '阿士匹灵门诊部', href: '/clinic', icon: 'stethoscope', title: '阿士匹灵门诊部', defaultSortOrder: 5, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, activePrefixes: ['/clinic'] },
  { featureKey: 'RATINGS', label: '歌·颂', href: '/ratings', icon: 'chart', title: '歌·颂', defaultSortOrder: 6, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, activePrefixes: ['/ratings'] },
  { featureKey: 'ACTIVITY_CENTER', label: '活动中心', href: '/activities', icon: 'calendar', title: '活动中心', defaultSortOrder: 7, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, activePrefixes: ['/activities'] },
  { featureKey: 'TODAY', label: '今日', href: '/today', icon: 'archive', title: '历史上的今天', defaultSortOrder: 8, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, activePrefixes: ['/today'] },
  { featureKey: 'BADGE_MUSEUM', label: '勋章展览馆', href: '/badges', icon: 'archive', title: 'E院勋章展览馆', defaultSortOrder: 9, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: true, activePrefixes: ['/badges'] },
  { featureKey: 'STICKERS', label: '表情包商店', href: '/stickers', icon: 'sticker', title: '表情包商店', defaultSortOrder: 10, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: true, activePrefixes: ['/stickers', '/profile/stickers'] },
  { featureKey: 'NOTIFICATIONS', label: '通知中心', href: '/notifications', icon: 'bell', title: '通知中心', defaultSortOrder: 11, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, showsUnread: true, activePrefixes: ['/notifications'] },
  { featureKey: 'FRIEND_ACTIVITY', label: '好友动态', href: '/friends/activity', icon: 'friends', title: '好友动态', defaultSortOrder: 12, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: true, activePrefixes: ['/friends'] },
  { featureKey: 'TRENDING_POSTS', label: '热门帖子', href: '/trending', icon: 'chart', title: '热门帖子', defaultSortOrder: 13, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, activePrefixes: ['/trending'] },
  { featureKey: 'FEEDBACK', label: '反馈与更新', href: '/feedback', icon: 'feedback', title: '反馈与更新', defaultSortOrder: 14, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: true, activePrefixes: ['/feedback'] },
  { featureKey: 'ADMIN', label: '后台管理', href: '/admin', icon: 'settings', title: '后台管理', defaultSortOrder: 15, defaultEnabled: true, isManageable: true, showInCenter: true, showInQuickNavigation: false, requiresAdmin: true, activePrefixes: ['/admin'] },
] as const satisfies readonly EcenterFeatureDefinition[]

export type EcenterFeatureDefinition = {
  featureKey: string
  label: string
  href: string
  icon: EcenterFeatureIcon
  title: string
  defaultSortOrder: number
  defaultEnabled: boolean
  isManageable: boolean
  showInCenter: boolean
  showInQuickNavigation: boolean
  activePrefixes: readonly string[]
  showsUnread?: boolean
  requiresAdmin?: boolean
}

export type EcenterFeatureIcon = Exclude<IconName, 'search' | 'edit' | 'grid' | 'menu' | 'arrow-up' | 'logout'>

export type EcenterFeatureKey = (typeof ECENTER_FEATURES)[number]['featureKey']

export type EcenterFeatureItem = {
  featureKey: EcenterFeatureKey
  label: string
  href: string
  icon: EcenterFeatureIcon
  title: string
  defaultSortOrder: number
  defaultEnabled: boolean
  sortOrder: number
  isEnabled: boolean
  isManageable: boolean
  showInCenter: boolean
  showInQuickNavigation: boolean
  activePrefixes: readonly string[]
  showsUnread: boolean
  requiresAdmin: boolean
  hidden: boolean
}

export type EcenterFeatureOverride = {
  featureKey: string
  sortOrder: number
  isEnabled: boolean
}

export type EcenterFeatureUpdate = {
  featureKey: EcenterFeatureKey
  sortOrder: number
  isEnabled: boolean
}

export type EcenterShortcutPreference = {
  itemKey: string
  sortOrder: number
  hidden: boolean
}

const registryByKey = new Map<string, EcenterFeatureDefinition>(ECENTER_FEATURES.map((feature) => [feature.featureKey, feature]))

function stableSort<T extends { sortOrder: number; defaultSortOrder: number; featureKey: string }>(features: T[]) {
  return [...features].sort((left, right) => (
    left.sortOrder - right.sortOrder
    || left.defaultSortOrder - right.defaultSortOrder
    || left.featureKey.localeCompare(right.featureKey)
  ))
}

export function mergeFeatureRegistryWithSettings(
  registry: readonly EcenterFeatureDefinition[],
  overrides: readonly EcenterFeatureOverride[] = [],
) {
  const overrideByKey = new Map(overrides.map((item) => [item.featureKey, item]))
  return stableSort(registry.map((definition) => {
    const override = overrideByKey.get(definition.featureKey)
    return {
      featureKey: definition.featureKey,
      label: definition.label,
      href: definition.href,
      icon: definition.icon,
      title: definition.title,
      defaultSortOrder: definition.defaultSortOrder,
      defaultEnabled: definition.defaultEnabled,
      sortOrder: Number.isSafeInteger(override?.sortOrder) && (override?.sortOrder ?? 0) >= 0 ? override!.sortOrder : definition.defaultSortOrder,
      isEnabled: typeof override?.isEnabled === 'boolean' ? override.isEnabled : definition.defaultEnabled,
      isManageable: definition.isManageable,
      showInCenter: definition.showInCenter,
      showInQuickNavigation: definition.showInQuickNavigation,
      activePrefixes: definition.activePrefixes,
      showsUnread: 'showsUnread' in definition && definition.showsUnread === true,
      requiresAdmin: 'requiresAdmin' in definition && definition.requiresAdmin === true,
      hidden: false,
    }
  }))
}

export function mergeEcenterFeatureSettings(overrides: readonly EcenterFeatureOverride[] = []): EcenterFeatureItem[] {
  return mergeFeatureRegistryWithSettings(ECENTER_FEATURES, overrides) as EcenterFeatureItem[]
}

export function filterEcenterFeaturesForUser(features: readonly EcenterFeatureItem[], canAccessAdmin: boolean) {
  return features.filter((feature) => (
    feature.showInCenter
    && feature.isEnabled
    && (!feature.requiresAdmin || canAccessAdmin)
  ))
}

export function applyEcenterShortcutPreferences(
  features: readonly EcenterFeatureItem[],
  preferences: readonly EcenterShortcutPreference[] = [],
) {
  const preferenceByKey = new Map(preferences.map((item) => [item.itemKey, item]))
  const merged = features.map((feature) => {
    const preference = preferenceByKey.get(feature.featureKey)
    return {
      ...feature,
      sortOrder: Number.isSafeInteger(preference?.sortOrder) && (preference?.sortOrder ?? 0) >= 0
        ? preference!.sortOrder
        : feature.sortOrder,
      hidden: preference ? preference.hidden : feature.hidden,
    }
  })
  return stableSort(merged)
}

export function getVisibleEcenterFeatures(
  features: readonly EcenterFeatureItem[],
  preferences: readonly EcenterShortcutPreference[] = [],
) {
  return applyEcenterShortcutPreferences(features, preferences).filter((feature) => !feature.hidden)
}

export function validateEcenterShortcutPreferences(
  value: unknown,
): { preferences: EcenterShortcutPreference[] } | { error: string } {
  if (!Array.isArray(value) || value.length > ECENTER_FEATURES.length) return { error: 'E院中心个性化设置格式不正确' }

  const preferences: EcenterShortcutPreference[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') return { error: 'E院中心个性化设置格式不正确' }
    const row = item as Record<string, unknown>
    const itemKey = typeof row.itemKey === 'string' ? row.itemKey : ''
    const definition = registryByKey.get(itemKey)
    if (!definition || !definition.isManageable || seen.has(itemKey)) return { error: '包含未知、重复或不可管理的 E院中心功能入口' }
    if (!Number.isSafeInteger(row.sortOrder) || Number(row.sortOrder) < 0 || Number(row.sortOrder) > 100000) {
      return { error: '入口排序必须是 0 至 100000 的整数' }
    }
    if (typeof row.hidden !== 'boolean') return { error: '入口隐藏状态格式不正确' }
    seen.add(itemKey)
    preferences.push({ itemKey, sortOrder: Number(row.sortOrder), hidden: row.hidden })
  }
  return { preferences }
}

export function validateEcenterFeatureUpdates(value: unknown): { updates: EcenterFeatureUpdate[] } | { error: string } {
  if (!Array.isArray(value) || value.length > ECENTER_FEATURES.length) return { error: 'E院中心排序数据格式不正确' }

  const updates: EcenterFeatureUpdate[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') return { error: 'E院中心排序数据格式不正确' }
    const row = item as Record<string, unknown>
    const featureKey = typeof row.featureKey === 'string' ? row.featureKey : ''
    const definition = registryByKey.get(featureKey)
    if (!definition || !definition.isManageable || seen.has(featureKey)) return { error: '包含未知、重复或不可管理的 E院中心功能入口' }
    const sortOrder = row.sortOrder
    if (!Number.isSafeInteger(sortOrder) || Number(sortOrder) < 0 || Number(sortOrder) > 100000) return { error: '入口排序必须是 0 至 100000 的整数' }
    if (typeof row.isEnabled !== 'boolean') return { error: '入口启用状态格式不正确' }
    seen.add(featureKey)
    updates.push({ featureKey: featureKey as EcenterFeatureKey, sortOrder: Number(sortOrder), isEnabled: row.isEnabled })
  }
  return { updates }
}

async function readOverrides(): Promise<EcenterFeatureOverride[]> {
  try {
    return await prisma.ecenterFeatureSetting.findMany({
      where: { featureKey: { in: ECENTER_FEATURES.map((feature) => feature.featureKey) } },
      select: { featureKey: true, sortOrder: true, isEnabled: true },
    })
  } catch (error) {
    // The registry remains a safe fallback during a rolling deploy before the
    // additive migration is applied. Do not take the whole application shell
    // down because navigation overrides are temporarily unavailable.
    console.warn('[ecenter-features.fallback]', { error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

export async function getAdminEcenterFeatureSettings() {
  return mergeEcenterFeatureSettings(await readOverrides())
}

async function readUserShortcutPreferences(userId: string): Promise<EcenterShortcutPreference[]> {
  try {
    return await prisma.userCenterShortcutPreference.findMany({
      where: { userId },
      select: { itemKey: true, sortOrder: true, hidden: true },
    })
  } catch (error) {
    // The user preference table is additive. During a rolling deploy, keep the
    // fixed registry available instead of taking the shell down.
    console.warn('[ecenter-features.user-fallback]', { error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

export async function getEcenterFeatureEditorState(userId: string, canAccessAdmin: boolean) {
  const systemFeatures = filterEcenterFeaturesForUser(mergeEcenterFeatureSettings(await readOverrides()), canAccessAdmin)
  return applyEcenterShortcutPreferences(systemFeatures, await readUserShortcutPreferences(userId))
}

export async function getEcenterFeaturesForUser(canAccessAdmin: boolean, userId?: string) {
  if (!userId) return filterEcenterFeaturesForUser(mergeEcenterFeatureSettings(await readOverrides()), canAccessAdmin)
  const features = await getEcenterFeatureEditorState(userId, canAccessAdmin)
  return features.filter((feature) => !feature.hidden)
}

export function getEcenterFeatureDefinition(featureKey: string) {
  return registryByKey.get(featureKey)
}

export function getEcenterFeatureKeys() {
  return ECENTER_FEATURES.map((feature) => feature.featureKey)
}
