export type ProfileBackgroundDevice = 'desktop' | 'mobile'

export type ProfileBackgroundTransform = {
  scale: number
  x: number
  y: number
}

export type ProfileBackgroundSize = {
  width: number
  height: number
}

export type ProfileBackgroundGeometry = {
  device: ProfileBackgroundDevice
  imageSize: ProfileBackgroundSize
  containerSize: ProfileBackgroundSize
}

export type ProfileBackgroundTransformFields = {
  backgroundDesktopScale?: number | null
  backgroundDesktopX?: number | null
  backgroundDesktopY?: number | null
  backgroundMobileScale?: number | null
  backgroundMobileX?: number | null
  backgroundMobileY?: number | null
}

export type ProfileBackgroundConstraints = {
  coverScale: number
  coverSize: ProfileBackgroundSize
  minScale: number
  maxScale: number
  minimumVisibleFraction: number
}

export type ProfileBackgroundDragBounds = {
  x: number
  y: number
}

export type ResolvedProfileBackgroundTransform = ProfileBackgroundTransform & {
  translateX: number
  translateY: number
  translateUnit: 'px' | '%'
}

export const PROFILE_BACKGROUND_BREAKPOINT_PX = 768
export const PROFILE_BACKGROUND_DESKTOP_ASPECT_RATIO = 9 / 2
// The mobile profile hero has a 210px minimum height at the existing mobile
// content width. Keeping that ratio here lets the editor use the same base
// viewport while the page remains responsive.
export const PROFILE_BACKGROUND_MOBILE_ASPECT_RATIO = 12 / 7

// `scale` is relative to the existing cover-centered composition. A value of
// 1 therefore preserves every legacy row, while the free-scale editor can go
// below cover without ever reducing the image to an imperceptible dot.
export const PROFILE_BACKGROUND_MIN_SCALE = 0.4
export const PROFILE_BACKGROUND_MAX_SCALE = 3
export const PROFILE_BACKGROUND_MIN_SCALE_CEILING = 0.6
export const PROFILE_BACKGROUND_MIN_VISIBLE_FRACTION = 0.2

const PROFILE_BACKGROUND_MIN_RENDERED_RATIO = {
  desktop: 0.45,
  mobile: 0.5,
} as const

export const DEFAULT_PROFILE_BACKGROUND_TRANSFORM: ProfileBackgroundTransform = {
  scale: 1,
  x: 0,
  y: 0,
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positiveSize(value: ProfileBackgroundSize | null | undefined): ProfileBackgroundSize | null {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) return null
  return { width: value.width, height: value.height }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function normalizeProfileBackgroundTransform(value: unknown): ProfileBackgroundTransform {
  const input = value && typeof value === 'object' ? value as Partial<ProfileBackgroundTransform> : {}
  return {
    scale: clamp(finiteNumber(input.scale, 1), PROFILE_BACKGROUND_MIN_SCALE, PROFILE_BACKGROUND_MAX_SCALE),
    x: clamp(finiteNumber(input.x, 0), -1, 1),
    y: clamp(finiteNumber(input.y, 0), -1, 1),
  }
}

export function parseProfileBackgroundTransform(value: unknown): ProfileBackgroundTransform | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (
    typeof input.scale !== 'number' ||
    typeof input.x !== 'number' ||
    typeof input.y !== 'number' ||
    !Number.isFinite(input.scale) ||
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y)
  ) return null
  return normalizeProfileBackgroundTransform({ scale: input.scale, x: input.x, y: input.y })
}

export function profileBackgroundTransformFromFields(
  fields: ProfileBackgroundTransformFields,
  device: ProfileBackgroundDevice,
): ProfileBackgroundTransform | null {
  const prefix = device === 'desktop' ? 'backgroundDesktop' : 'backgroundMobile'
  const scale = fields[`${prefix}Scale` as keyof ProfileBackgroundTransformFields]
  const x = fields[`${prefix}X` as keyof ProfileBackgroundTransformFields]
  const y = fields[`${prefix}Y` as keyof ProfileBackgroundTransformFields]
  if (scale == null && x == null && y == null) return null
  return normalizeProfileBackgroundTransform({ scale, x, y })
}

export function profileBackgroundTransformToFields(
  device: ProfileBackgroundDevice,
  transform: ProfileBackgroundTransform | null,
): ProfileBackgroundTransformFields {
  const prefix = device === 'desktop' ? 'backgroundDesktop' : 'backgroundMobile'
  if (!transform) {
    return {
      [`${prefix}Scale`]: null,
      [`${prefix}X`]: null,
      [`${prefix}Y`]: null,
    }
  }
  const normalized = normalizeProfileBackgroundTransform(transform)
  return {
    [`${prefix}Scale`]: normalized.scale,
    [`${prefix}X`]: normalized.x,
    [`${prefix}Y`]: normalized.y,
  }
}

export function getProfileBackgroundConstraints({
  device,
  imageSize,
  containerSize,
}: {
  device: ProfileBackgroundDevice
  imageSize?: ProfileBackgroundSize | null
  containerSize?: ProfileBackgroundSize | null
}): ProfileBackgroundConstraints {
  const image = positiveSize(imageSize)
  const container = positiveSize(containerSize)
  const minimumVisibleFraction = PROFILE_BACKGROUND_MIN_VISIBLE_FRACTION

  // Before the browser has loaded the image, use a deterministic cover-shaped
  // fallback. Once both sizes are available the same calculation is used by
  // the editor and the real profile hero.
  if (!image || !container) {
    return {
      coverScale: 1,
      coverSize: container || { width: 1, height: 1 },
      minScale: device === 'mobile' ? 0.5 : 0.45,
      maxScale: PROFILE_BACKGROUND_MAX_SCALE,
      minimumVisibleFraction,
    }
  }

  const coverScale = Math.max(container.width / image.width, container.height / image.height)
  const coverSize = {
    width: image.width * coverScale,
    height: image.height * coverScale,
  }
  const containerShortEdge = Math.min(container.width, container.height)
  const coverShortEdge = Math.min(coverSize.width, coverSize.height)
  const minimumRenderedRatio = PROFILE_BACKGROUND_MIN_RENDERED_RATIO[device]
  const calculatedMinScale = (containerShortEdge * minimumRenderedRatio) / coverShortEdge

  return {
    coverScale,
    coverSize,
    minScale: clamp(calculatedMinScale, PROFILE_BACKGROUND_MIN_SCALE, PROFILE_BACKGROUND_MIN_SCALE_CEILING),
    maxScale: PROFILE_BACKGROUND_MAX_SCALE,
    minimumVisibleFraction,
  }
}

function maxAxisOffset(containerLength: number, renderedLength: number, minimumVisibleFraction: number) {
  const minimumVisibleLength = Math.min(renderedLength * minimumVisibleFraction, containerLength)
  return Math.max(0, (containerLength + renderedLength) / 2 - minimumVisibleLength)
}

export function getProfileBackgroundDragBounds({
  device,
  imageSize,
  containerSize,
  scale,
}: ProfileBackgroundGeometry & { scale: number }): ProfileBackgroundDragBounds {
  const constraints = getProfileBackgroundConstraints({ device, imageSize, containerSize })
  const safeScale = clamp(finiteNumber(scale, 1), PROFILE_BACKGROUND_MIN_SCALE, constraints.maxScale)
  const renderedWidth = constraints.coverSize.width * safeScale
  const renderedHeight = constraints.coverSize.height * safeScale
  return {
    x: maxAxisOffset(containerSize.width, renderedWidth, constraints.minimumVisibleFraction),
    y: maxAxisOffset(containerSize.height, renderedHeight, constraints.minimumVisibleFraction),
  }
}

export function constrainProfileBackgroundTransform(
  transform: ProfileBackgroundTransform | null,
  geometry?: ProfileBackgroundGeometry | null,
): ProfileBackgroundTransform {
  const normalized = normalizeProfileBackgroundTransform(transform)
  if (!geometry) return normalized
  const constraints = getProfileBackgroundConstraints(geometry)
  return normalizeProfileBackgroundTransform({
    ...normalized,
    scale: clamp(normalized.scale, constraints.minScale, constraints.maxScale),
  })
}

export function resolveProfileBackgroundTransform(
  transform: ProfileBackgroundTransform | null,
  geometry?: ProfileBackgroundGeometry | null,
): ResolvedProfileBackgroundTransform {
  const normalized = constrainProfileBackgroundTransform(transform, geometry)
  if (!geometry) {
    return {
      ...normalized,
      // Keep a deterministic SSR/legacy fallback. The browser replaces this
      // with measured pixel bounds after the image and frame are available.
      translateX: normalized.x * Math.abs(normalized.scale - 1) * 50,
      translateY: normalized.y * Math.abs(normalized.scale - 1) * 50,
      translateUnit: '%',
    }
  }

  const bounds = getProfileBackgroundDragBounds({ ...geometry, scale: normalized.scale })
  return {
    ...normalized,
    translateX: normalized.x * bounds.x,
    translateY: normalized.y * bounds.y,
    translateUnit: 'px',
  }
}

export function profileBackgroundTransformStyle(
  transform: ProfileBackgroundTransform | null,
  geometry?: ProfileBackgroundGeometry | null,
) {
  const resolved = resolveProfileBackgroundTransform(transform, geometry)
  if (geometry) {
    const constraints = getProfileBackgroundConstraints(geometry)
    const translateX = `${resolved.translateX.toFixed(4)}px`
    const translateY = `${resolved.translateY.toFixed(4)}px`
    return {
      width: `${constraints.coverSize.width.toFixed(4)}px`,
      height: `${constraints.coverSize.height.toFixed(4)}px`,
      maxWidth: 'none',
      position: 'absolute' as const,
      left: `calc(50% + ${translateX})`,
      top: `calc(50% + ${translateY})`,
      transformOrigin: 'center center',
      transform: `translate3d(-50%, -50%, 0) scale(${resolved.scale.toFixed(4)})`,
    }
  }
  const translateX = `${resolved.translateX.toFixed(4)}${resolved.translateUnit}`
  const translateY = `${resolved.translateY.toFixed(4)}${resolved.translateUnit}`
  return {
    width: '100%',
    height: '100%',
    maxWidth: 'none',
    objectFit: 'cover' as const,
    transformOrigin: 'center center',
    transform: `translate3d(${translateX}, ${translateY}, 0) scale(${resolved.scale.toFixed(4)})`,
  }
}

export function updateProfileBackgroundTransformForDrag(
  transform: ProfileBackgroundTransform,
  deltaX: number,
  deltaY: number,
  frameWidth: number,
  frameHeight: number,
  geometry?: ProfileBackgroundGeometry | null,
) {
  const normalized = normalizeProfileBackgroundTransform(transform)
  const dragGeometry = geometry || {
    device: 'desktop' as const,
    imageSize: { width: frameWidth, height: frameHeight },
    containerSize: { width: frameWidth, height: frameHeight },
  }
  const bounds = getProfileBackgroundDragBounds({ ...dragGeometry, scale: normalized.scale })
  return normalizeProfileBackgroundTransform({
    ...normalized,
    x: bounds.x > 0 ? normalized.x + deltaX / bounds.x : normalized.x,
    y: bounds.y > 0 ? normalized.y + deltaY / bounds.y : normalized.y,
  })
}
