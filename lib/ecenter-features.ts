import { prisma } from '@/lib/prisma'
import {
  NAVIGATION_REGISTRY,
  type NavigationFeatureKey,
  type NavigationRegistryItem,
} from '@/lib/navigation-registry'

export { NAVIGATION_REGISTRY }

/**
 * The E院中心 registry is the only source of fixed feature metadata.
 * Database rows may override order and visibility only; they never provide
 * routes, icons, labels, or permissions.
 */
export const ECENTER_FEATURES = NAVIGATION_REGISTRY

export type EcenterFeatureDefinition = NavigationRegistryItem
export type EcenterFeatureIcon = NavigationRegistryItem['icon']

export type EcenterFeatureKey = NavigationFeatureKey

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
  showInDesktopSidebar: boolean
  sidebarSection: NavigationRegistryItem['sidebarSection']
  mobile?: boolean
  editable: boolean
  hideable: boolean
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

function compareFeatureOrder<T extends { sortOrder: number; defaultSortOrder: number; featureKey: string }>(left: T, right: T) {
  return left.sortOrder - right.sortOrder
    || left.defaultSortOrder - right.defaultSortOrder
    || left.featureKey.localeCompare(right.featureKey)
}

function stableSort<T extends { sortOrder: number; defaultSortOrder: number; featureKey: string }>(features: T[]) {
  return [...features].sort(compareFeatureOrder)
}

export function mergeFeatureRegistryWithSettings(
  registry: readonly EcenterFeatureDefinition[],
  overrides: readonly EcenterFeatureOverride[] = [],
) {
  const overrideByKey = new Map(overrides.map((item) => [item.featureKey, item]))
  return stableSort(registry.map((definition) => {
    const override = overrideByKey.get(definition.featureKey)
    return {
      ...definition,
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
      showInDesktopSidebar: definition.showInDesktopSidebar,
      sidebarSection: definition.sidebarSection,
      mobile: definition.mobile,
      editable: definition.editable,
      hideable: definition.hideable,
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

/**
 * The editor needs the union of the desktop sidebar and E院中心 entries.
 * Entries that only belong to E院中心 remain available for the mobile
 * surface, while desktop-only entries are no longer invisible to the editor.
 */
export function filterEcenterFeaturesForEditor(features: readonly EcenterFeatureItem[], canAccessAdmin: boolean) {
  return features.filter((feature) => (
    (feature.showInCenter || feature.showInDesktopSidebar)
    && feature.isEnabled
    && (!feature.requiresAdmin || canAccessAdmin)
  ))
}

export function applyEcenterShortcutPreferences(
  features: readonly EcenterFeatureItem[],
  preferences: readonly EcenterShortcutPreference[] = [],
) {
  const preferenceByKey = new Map(preferences.map((item) => [item.itemKey, item]))
  const ordered = [...features].sort((left, right) => {
    const leftPreference = preferenceByKey.get(left.featureKey)
    const rightPreference = preferenceByKey.get(right.featureKey)
    if (leftPreference && rightPreference) {
      return leftPreference.sortOrder - rightPreference.sortOrder
        || left.defaultSortOrder - right.defaultSortOrder
        || left.featureKey.localeCompare(right.featureKey)
    }
    if (leftPreference) return -1
    if (rightPreference) return 1
    return compareFeatureOrder(left, right)
  })
  return ordered.map((feature, index) => ({
    ...feature,
    sortOrder: index,
    hidden: feature.hideable
      ? (preferenceByKey.get(feature.featureKey)?.hidden ?? feature.hidden)
      : false,
  }))
}

/** Keep the current array order and assign dense persisted positions. */
export function normalizeEcenterFeatureOrder(features: readonly EcenterFeatureItem[]) {
  return features.map((feature, index) => ({ ...feature, sortOrder: index }))
}

/** Reorder only visible entries while keeping hidden entries at their existing positions. */
export function reorderEcenterFeatures(
  features: readonly EcenterFeatureItem[],
  featureKey: string,
  targetIndex: number,
  options: Readonly<{ include?: (feature: EcenterFeatureItem) => boolean }> = {},
) {
  const ordered = stableSort([...features])
  const include = options.include || (() => true)
  const visible = ordered.filter((feature) => !feature.hidden && include(feature))
  const currentIndex = visible.findIndex((feature) => feature.featureKey === featureKey)
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visible.length || currentIndex === targetIndex) {
    return normalizeEcenterFeatureOrder(ordered)
  }

  const nextVisible = [...visible]
  const [moved] = nextVisible.splice(currentIndex, 1)
  nextVisible.splice(targetIndex, 0, moved)
  let visibleIndex = 0
  const next = ordered.map((feature) => (
    feature.hidden || !include(feature) ? feature : nextVisible[visibleIndex++]
  ))
  return normalizeEcenterFeatureOrder(next)
}

/** Hide/show an entry without changing its saved position. */
export function setEcenterFeatureHidden(
  features: readonly EcenterFeatureItem[],
  featureKey: string,
  hidden: boolean,
) {
  return normalizeEcenterFeatureOrder(stableSort([...features]).map((feature) => (
    feature.featureKey === featureKey ? { ...feature, hidden: feature.hideable ? hidden : false } : feature
  )))
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
    if (!definition || !definition.editable || seen.has(itemKey)) return { error: '包含未知、重复或不可管理的 E院中心功能入口' }
    if (!Number.isSafeInteger(row.sortOrder) || Number(row.sortOrder) < 0 || Number(row.sortOrder) > 100000) {
      return { error: '入口排序必须是 0 至 100000 的整数' }
    }
    if (typeof row.hidden !== 'boolean') return { error: '入口隐藏状态格式不正确' }
    if (!definition.hideable && row.hidden === true) return { error: '固定入口不允许隐藏' }
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
  const systemFeatures = filterEcenterFeaturesForEditor(mergeEcenterFeatureSettings(await readOverrides()), canAccessAdmin)
  return applyEcenterShortcutPreferences(systemFeatures, await readUserShortcutPreferences(userId))
}

export async function getEcenterFeaturesForUser(canAccessAdmin: boolean, userId?: string) {
  if (!userId) return filterEcenterFeaturesForEditor(mergeEcenterFeatureSettings(await readOverrides()), canAccessAdmin)
  const features = await getEcenterFeatureEditorState(userId, canAccessAdmin)
  return features.filter((feature) => !feature.hidden)
}

export function getEcenterFeatureDefinition(featureKey: string) {
  return registryByKey.get(featureKey)
}

export function getEcenterFeatureKeys() {
  return ECENTER_FEATURES.map((feature) => feature.featureKey)
}
