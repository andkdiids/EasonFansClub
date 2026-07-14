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

  input.forEach((rawItem, index) => {
    if (!isPlainObject(rawItem)) {
      errors[`${device}.${index}`] = '模块配置格式不正确'
      return
    }

    const key = typeof rawItem.key === 'string' ? rawItem.key : ''
    const definition = getPageLayoutModule(pageKey, key)
    if (!definition) {
      if (strict) errors[`${device}.${index}.key`] = '模块不存在或不属于当前页面'
      return
    }
    if (seen.has(key)) {
      if (strict) errors[`${device}.${key}`] = '同一设备布局中模块不能重复'
      return
    }
    if (device === 'desktop' && !definition.supportsDesktop) {
      if (strict) errors[`${device}.${key}`] = '该模块不支持桌面端'
      return
    }
    if (device === 'mobile' && !definition.supportsMobile) {
      if (strict) errors[`${device}.${key}`] = '该模块不支持移动端'
      return
    }

    const fallbackItem = fallback.find((item) => item.key === key)
    const width = definition.allowedWidths.includes(rawItem.width as LayoutWidth)
      ? rawItem.width as LayoutWidth
      : fallbackItem?.width || definition.defaultWidth
    const gapTop = definition.allowedSpacing.includes(rawItem.gapTop as LayoutSpacing)
      ? rawItem.gapTop as LayoutSpacing
      : fallbackItem?.gapTop || definition.defaultGapTop
    const gapBottom = definition.allowedSpacing.includes(rawItem.gapBottom as LayoutSpacing)
      ? rawItem.gapBottom as LayoutSpacing
      : fallbackItem?.gapBottom || definition.defaultGapBottom
    const alignment = includes(layoutAlignments, rawItem.alignment)
      ? rawItem.alignment as LayoutAlignment
      : fallbackItem?.alignment || 'left'
    const density = includes(layoutDensities, rawItem.density)
      ? rawItem.density as LayoutDensity
      : fallbackItem?.density || 'normal'
    const title = cleanText(rawItem.title, 60)
    const subtitle = cleanText(rawItem.subtitle, 160)

    if (strict && rawItem.width !== undefined && !definition.allowedWidths.includes(rawItem.width as LayoutWidth)) {
      errors[`${device}.${key}.width`] = '宽度不在允许范围内'
    }
    if (strict && rawItem.gapTop !== undefined && !definition.allowedSpacing.includes(rawItem.gapTop as LayoutSpacing)) {
      errors[`${device}.${key}.gapTop`] = '上间距不在允许范围内'
    }
    if (strict && rawItem.gapBottom !== undefined && !definition.allowedSpacing.includes(rawItem.gapBottom as LayoutSpacing)) {
      errors[`${device}.${key}.gapBottom`] = '下间距不在允许范围内'
    }
    if (strict && rawItem.alignment !== undefined && !includes(layoutAlignments, rawItem.alignment)) {
      errors[`${device}.${key}.alignment`] = '对齐方式不在允许范围内'
    }
    if (strict && rawItem.density !== undefined && !includes(layoutDensities, rawItem.density)) {
      errors[`${device}.${key}.density`] = '密度不在允许范围内'
    }
    if (strict && !definition.supportsTitle && title) {
      errors[`${device}.${key}.title`] = '该模块不支持自定义标题'
    }
    if (strict && !definition.supportsSubtitle && subtitle) {
      errors[`${device}.${key}.subtitle`] = '该模块不支持自定义副标题'
    }

    seen.add(key)
    sanitized.push({
      key,
      order: normalizeOrder(rawItem.order, fallbackItem?.order || definition.defaultOrder),
      visible: typeof rawItem.visible === 'boolean' ? rawItem.visible : definition.defaultVisible,
      width,
      gapTop,
      gapBottom,
      alignment,
      density,
      title: definition.supportsTitle ? title : null,
      subtitle: definition.supportsSubtitle ? subtitle : null,
    })
  })

  const requiredModules = getPageLayoutRegistry(pageKey).filter((item) => {
    return item.required && (device === 'desktop' ? item.supportsDesktop : item.supportsMobile)
  })
  requiredModules.forEach((module) => {
    const item = sanitized.find((config) => config.key === module.key)
    if (!item) {
      if (strict) errors[`${device}.${module.key}.visible`] = '核心模块必须保留显示'
      return
    }
    if (!item.visible) {
      if (strict) {
        errors[`${device}.${module.key}.visible`] = '核心模块必须保留显示'
      } else {
        item.visible = true
      }
    }
  })

  if (sanitized.every((item) => !item.visible)) {
    if (strict) {
      errors[`${device}.visible`] = '不能隐藏当前页面的所有模块'
    } else {
      const fallbackVisible = sanitized.find((item) => fallback.some((fallbackItem) => fallbackItem.key === item.key && fallbackItem.visible))
      if (fallbackVisible) fallbackVisible.visible = true
    }
  }

  if (Object.keys(errors).length) {
    throw new PageLayoutValidationError('页面布局配置不正确', errors)
  }

  const missingDefaults = fallback.filter((item) => !seen.has(item.key))
  return [...sanitized, ...missingDefaults].sort((a, b) => a.order - b.order)
}

export function validatePageLayoutConfig(pageKey: PageLayoutPageKey, input: unknown): PageLayoutConfig {
  const defaults = getDefaultPageLayoutConfig(pageKey)
  if (!isPlainObject(input)) return defaults

  return {
    desktop: validateDeviceConfig(pageKey, 'desktop', input.desktop, defaults.desktop),
    mobile: validateDeviceConfig(pageKey, 'mobile', input.mobile, defaults.mobile),
  }
}

export function repairPageLayoutConfig(pageKey: PageLayoutPageKey, input: unknown): PageLayoutConfig {
  const defaults = getDefaultPageLayoutConfig(pageKey)
  if (!isPlainObject(input)) return defaults

  return {
    desktop: validateDeviceConfig(pageKey, 'desktop', input.desktop, defaults.desktop, false),
    mobile: validateDeviceConfig(pageKey, 'mobile', input.mobile, defaults.mobile, false),
  }
}
