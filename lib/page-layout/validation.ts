import {
  getDefaultPageLayoutConfig,
  getPageLayoutModule,
  getPageLayoutRegistry,
} from '@/lib/page-layout/registry'
import {
  layoutAlignments,
  layoutDensities,
  type LayoutAlignment,
  type LayoutDensity,
  type LayoutSpacing,
  type LayoutWidth,
  type PageLayoutConfig,
  type PageLayoutDevice,
  type PageLayoutGridItem,
  type PageLayoutModuleConfig,
  type PageLayoutPageKey,
} from '@/lib/page-layout/types'

export class PageLayoutValidationError extends Error {
  constructor(message: string, public readonly details: Record<string, string> = {}) {
    super(message)
    this.name = 'PageLayoutValidationError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function columnsFor(device: PageLayoutDevice) {
  if (device === 'desktop') return 12
  if (device === 'tablet') return 8
  return 4
}

function cleanText(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').trim()
  return text ? text.slice(0, maxLength) : null
}

function normalizeOrder(value: unknown, fallback: number) {
  const order = Number(value)
  if (!Number.isSafeInteger(order) || order < 0 || order > 10000) return fallback
  return order
}

function normalizeGrid(value: unknown, fallback: PageLayoutGridItem, columns: number): PageLayoutGridItem {
  const input = isPlainObject(value) ? value : {}
  const rawW = Number(input.w)
  const safeW = Number.isSafeInteger(rawW) && rawW >= 1 && rawW <= columns ? rawW : Math.min(fallback.w, columns)
  const rawX = Number(input.x)
  const safeX = Number.isSafeInteger(rawX) && rawX >= 0 && rawX + safeW <= columns ? rawX : Math.min(fallback.x, columns - safeW)
  const rawY = Number(input.y)
  const rawH = Number(input.h)

  return {
    x: safeX,
    y: Number.isSafeInteger(rawY) && rawY >= 0 && rawY <= 200 ? rawY : fallback.y,
    w: safeW,
    h: Number.isSafeInteger(rawH) && rawH >= 1 && rawH <= 40 ? rawH : fallback.h,
  }
}

function validateRawGrid(
  errors: Record<string, string>,
  device: PageLayoutDevice,
  key: string,
  value: unknown,
) {
  if (!isPlainObject(value)) return
  const columns = columnsFor(device)
  const rawW = Number(value.w)
  const rawX = Number(value.x)
  const rawY = Number(value.y)
  const rawH = Number(value.h)

  if (!Number.isSafeInteger(rawW) || rawW < 1 || rawW > columns) errors[`${device}.${key}.grid.w`] = `${device} 模块宽度超出 ${columns} 列`
  if (!Number.isSafeInteger(rawX) || rawX < 0 || rawX + (Number.isSafeInteger(rawW) ? rawW : 1) > columns) errors[`${device}.${key}.grid.x`] = `${device} 模块横向位置超出 ${columns} 列`
  if (!Number.isSafeInteger(rawY) || rawY < 0 || rawY > 200) errors[`${device}.${key}.grid.y`] = `${device} 模块纵向位置不在允许范围内`
  if (!Number.isSafeInteger(rawH) || rawH < 1 || rawH > 40) errors[`${device}.${key}.grid.h`] = `${device} 模块高度不在允许范围内`
}

function supportsDevice(moduleDefinition: { supportsDesktop: boolean; supportsTablet: boolean; supportsMobile: boolean }, device: PageLayoutDevice) {
  if (device === 'desktop') return moduleDefinition.supportsDesktop
  if (device === 'tablet') return moduleDefinition.supportsTablet
  return moduleDefinition.supportsMobile
}

function isLegacySingleModule(pageKey: PageLayoutPageKey, key: string) {
  return (pageKey === 'forum' && key === 'forum.board') || (pageKey === 'announcement' && key === 'announcement.board')
}

function isLegacyCheckInModule(pageKey: PageLayoutPageKey, key: string) {
  return pageKey === 'checkin' && (
    key === 'checkin.stats'
    || key === 'checkin.today'
    || key === 'checkin.formOrMood'
    || key === 'checkin.messages'
  )
}

function validateDeviceConfig(
  pageKey: PageLayoutPageKey,
  device: PageLayoutDevice,
  input: unknown,
  fallback: PageLayoutModuleConfig[],
  strict = true,
) {
  if (!Array.isArray(input)) return fallback

  const errors: Record<string, string> = {}
  const seen = new Set<string>()
  const sanitized: PageLayoutModuleConfig[] = []
  const hasLegacyToday = input.some((rawItem) => {
    if (!isPlainObject(rawItem)) return false
    return rawItem.key === 'checkin.today' || rawItem.key === 'checkin.formOrMood'
  })

  input.forEach((rawItem, index) => {
    if (!isPlainObject(rawItem)) {
      errors[`${device}.${index}`] = '模块配置格式不正确'
      return
    }

    const rawKey = typeof rawItem.key === 'string' ? rawItem.key : ''
    if (isLegacyCheckInModule(pageKey, rawKey)) return
    const key = rawKey
    const definition = getPageLayoutModule(pageKey, key)
    if (!definition) {
      if (strict && !isLegacySingleModule(pageKey, rawKey)) errors[`${device}.${index}.key`] = '模块不存在或不属于当前页面'
      return
    }
    if (seen.has(key)) {
      if (strict) errors[`${device}.${key}`] = '模块 ID 重复'
      return
    }
    if (!supportsDevice(definition, device)) {
      if (strict) errors[`${device}.${key}`] = '该模块不支持当前设备'
      return
    }

    const fallbackItem = fallback.find((item) => item.key === key)
    if (!fallbackItem) return
    const width = definition.allowedWidths.includes(rawItem.width as LayoutWidth)
      ? rawItem.width as LayoutWidth
      : fallbackItem.width || definition.defaultWidth
    const gapTop = definition.allowedSpacing.includes(rawItem.gapTop as LayoutSpacing)
      ? rawItem.gapTop as LayoutSpacing
      : fallbackItem.gapTop || definition.defaultGapTop
    const gapBottom = definition.allowedSpacing.includes(rawItem.gapBottom as LayoutSpacing)
      ? rawItem.gapBottom as LayoutSpacing
      : fallbackItem.gapBottom || definition.defaultGapBottom
    const alignment = includes(layoutAlignments, rawItem.alignment)
      ? rawItem.alignment as LayoutAlignment
      : fallbackItem.alignment || 'left'
    const density = includes(layoutDensities, rawItem.density)
      ? rawItem.density as LayoutDensity
      : fallbackItem.density || 'normal'
    const title = cleanText(rawItem.title, 60)
    const subtitle = cleanText(rawItem.subtitle, 160)
    const grid = isPlainObject(rawItem.grid) && rawItem.grid[device] !== undefined
      ? normalizeGrid(rawItem.grid[device], fallbackItem.grid[device], columnsFor(device))
      : normalizeGrid(rawItem, fallbackItem.grid[device], columnsFor(device))

    if (strict && rawItem.width !== undefined && !definition.allowedWidths.includes(rawItem.width as LayoutWidth)) errors[`${device}.${key}.width`] = '宽度不在允许范围内'
    if (strict && rawItem.gapTop !== undefined && !definition.allowedSpacing.includes(rawItem.gapTop as LayoutSpacing)) errors[`${device}.${key}.gapTop`] = '上间距不在允许范围内'
    if (strict && rawItem.gapBottom !== undefined && !definition.allowedSpacing.includes(rawItem.gapBottom as LayoutSpacing)) errors[`${device}.${key}.gapBottom`] = '下间距不在允许范围内'
    if (strict && rawItem.alignment !== undefined && !includes(layoutAlignments, rawItem.alignment)) errors[`${device}.${key}.alignment`] = '对齐方式不在允许范围内'
    if (strict && rawItem.density !== undefined && !includes(layoutDensities, rawItem.density)) errors[`${device}.${key}.density`] = '密度不在允许范围内'
    if (strict && rawItem.isHidden !== undefined && typeof rawItem.isHidden !== 'boolean') errors[`${device}.${key}.isHidden`] = '模块隐藏状态必须是 boolean'
    if (strict && isPlainObject(rawItem.grid) && rawItem.grid[device] !== undefined) validateRawGrid(errors, device, key, rawItem.grid[device])
    if (strict && !definition.supportsTitle && title) errors[`${device}.${key}.title`] = '该模块不支持自定义标题'
    if (strict && !definition.supportsSubtitle && subtitle) errors[`${device}.${key}.subtitle`] = '该模块不支持自定义副标题'

    const rawHidden = typeof rawItem.isHidden === 'boolean'
      ? rawItem.isHidden
      : typeof rawItem.visible === 'boolean'
        ? !rawItem.visible
        : !definition.defaultVisible
    const isHidden = definition.required ? false : rawHidden

    seen.add(key)
    sanitized.push({
      key,
      order: normalizeOrder(rawItem.order, fallbackItem.order || definition.defaultOrder),
      visible: !isHidden,
      isHidden,
      grid: {
        desktop: device === 'desktop' ? grid : fallbackItem.grid.desktop,
        tablet: device === 'tablet' ? grid : fallbackItem.grid.tablet,
        mobile: device === 'mobile' ? grid : fallbackItem.grid.mobile,
      },
      width,
      gapTop,
      gapBottom,
      alignment,
      density,
      title: definition.supportsTitle ? title : null,
      subtitle: definition.supportsSubtitle ? subtitle : null,
    })
  })

  const requiredModules = getPageLayoutRegistry(pageKey).filter((item) => item.required && supportsDevice(item, device))
  requiredModules.forEach((moduleDefinition) => {
    const item = sanitized.find((config) => config.key === moduleDefinition.key)
    if (!item) {
      if (strict) errors[`${device}.${moduleDefinition.key}.isHidden`] = '核心模块必须保留显示'
      return
    }
    if (item.isHidden) {
      if (strict) {
        errors[`${device}.${moduleDefinition.key}.isHidden`] = '核心模块必须保留显示'
      } else {
        item.isHidden = false
        item.visible = true
      }
    }
  })

  if (sanitized.length > 0 && sanitized.every((item) => item.isHidden)) {
    if (strict) {
      errors[`${device}.isHidden`] = '不能隐藏当前页面的所有模块'
    } else {
      const fallbackVisible = sanitized.find((item) => fallback.some((fallbackItem) => fallbackItem.key === item.key && !fallbackItem.isHidden))
      if (fallbackVisible) {
        fallbackVisible.isHidden = false
        fallbackVisible.visible = true
      }
    }
  }

  if (Object.keys(errors).length) throw new PageLayoutValidationError('页面布局配置不正确', errors)

  const missingDefaults = fallback.filter((item) => !seen.has(item.key))
  const merged = [...sanitized, ...missingDefaults]
  if (pageKey !== 'checkin') return merged

  const headerDefaultGrid = fallback.find((item) => item.key === 'checkin.header')?.grid[device]
  const upgraded = hasLegacyToday
    ? merged.map((item) => item.key === 'checkin.header'
      ? {
          ...item,
          grid: {
            ...item.grid,
            [device]: {
              ...item.grid[device],
              x: 0,
              w: columnsFor(device),
              h: Math.max(item.grid[device].h, headerDefaultGrid?.h ?? 1),
            },
          },
        }
      : item)
    : merged
  return upgradeCheckInHeader(upgraded, device)
}

export function validatePageLayoutConfig(pageKey: PageLayoutPageKey, input: unknown): PageLayoutConfig {
  const defaults = getDefaultPageLayoutConfig(pageKey)
  if (!isPlainObject(input)) return defaults

  return {
    desktop: validateDeviceConfig(pageKey, 'desktop', input.desktop, defaults.desktop),
    tablet: validateDeviceConfig(pageKey, 'tablet', input.tablet, defaults.tablet),
    mobile: validateDeviceConfig(pageKey, 'mobile', input.mobile, defaults.mobile),
  }
}

export function repairPageLayoutConfig(pageKey: PageLayoutPageKey, input: unknown): PageLayoutConfig {
  const defaults = getDefaultPageLayoutConfig(pageKey)
  if (!isPlainObject(input)) return defaults

  const repaired = {
    desktop: validateDeviceConfig(pageKey, 'desktop', input.desktop, defaults.desktop, false),
    tablet: validateDeviceConfig(pageKey, 'tablet', input.tablet, defaults.tablet, false),
    mobile: validateDeviceConfig(pageKey, 'mobile', input.mobile, defaults.mobile, false),
  }
  if (pageKey !== 'checkin') return repaired

  return {
    desktop: upgradeCheckInHeader(repaired.desktop, 'desktop'),
    tablet: upgradeCheckInHeader(repaired.tablet, 'tablet'),
    mobile: upgradeCheckInHeader(repaired.mobile, 'mobile'),
  }
}

function upgradeCheckInHeader(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  const header = items.find((item) => item.key === 'checkin.header')
  const headerEnd = header ? header.grid[device].y + header.grid[device].h : 0
  const publicMessages = items.find((item) => item.key === 'checkin.publicMessages')
  const friendY = device === 'desktop'
    ? headerEnd
    : headerEnd + (publicMessages?.grid[device].h ?? 0)
  return items.map((item) => {
    if (item.key === 'checkin.publicMessages') return { ...item, grid: { ...item.grid, [device]: { ...item.grid[device], y: headerEnd } } }
    if (item.key === 'checkin.friendMessages') return { ...item, grid: { ...item.grid, [device]: { ...item.grid[device], y: friendY } } }
    return item
  })
}
