export type ProfileBackgroundDevice = 'desktop' | 'mobile'

export type ProfileBackgroundTransform = {
  scale: number
  x: number
  y: number
}

export type ProfileBackgroundTransformFields = {
  backgroundDesktopScale?: number | null
  backgroundDesktopX?: number | null
  backgroundDesktopY?: number | null
  backgroundMobileScale?: number | null
  backgroundMobileX?: number | null
  backgroundMobileY?: number | null
}

export const PROFILE_BACKGROUND_BREAKPOINT_PX = 768
export const PROFILE_BACKGROUND_DESKTOP_ASPECT_RATIO = 9 / 2
// The mobile profile hero has a 210px minimum height at the existing mobile
// content width. Keeping that ratio here lets the editor use the same base
// viewport while the page remains responsive.
export const PROFILE_BACKGROUND_MOBILE_ASPECT_RATIO = 12 / 7
export const PROFILE_BACKGROUND_MIN_SCALE = 1
export const PROFILE_BACKGROUND_MAX_SCALE = 3

export const DEFAULT_PROFILE_BACKGROUND_TRANSFORM: ProfileBackgroundTransform = {
  scale: 1,
  x: 0,
  y: 0,
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeProfileBackgroundTransform(value: unknown): ProfileBackgroundTransform {
  const input = value && typeof value === 'object' ? value as Partial<ProfileBackgroundTransform> : {}
  return {
    scale: Math.max(PROFILE_BACKGROUND_MIN_SCALE, Math.min(PROFILE_BACKGROUND_MAX_SCALE, finiteNumber(input.scale, 1))),
    x: Math.max(-1, Math.min(1, finiteNumber(input.x, 0))),
    y: Math.max(-1, Math.min(1, finiteNumber(input.y, 0))),
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

export function profileBackgroundTransformStyle(transform: ProfileBackgroundTransform | null) {
  const normalized = normalizeProfileBackgroundTransform(transform)
  const translateX = normalized.x * (normalized.scale - 1) * 50
  const translateY = normalized.y * (normalized.scale - 1) * 50
  return {
    width: '100%',
    height: '100%',
    maxWidth: 'none',
    objectFit: 'cover' as const,
    transformOrigin: 'center center',
    transform: `translate3d(${translateX.toFixed(4)}%, ${translateY.toFixed(4)}%, 0) scale(${normalized.scale.toFixed(4)})`,
  }
}

export function updateProfileBackgroundTransformForDrag(
  transform: ProfileBackgroundTransform,
  deltaX: number,
  deltaY: number,
  frameWidth: number,
  frameHeight: number,
) {
  const normalized = normalizeProfileBackgroundTransform(transform)
  const maxX = Math.max(0, frameWidth * (normalized.scale - 1) / 2)
  const maxY = Math.max(0, frameHeight * (normalized.scale - 1) / 2)
  return normalizeProfileBackgroundTransform({
    ...normalized,
    x: maxX > 0 ? normalized.x + deltaX / maxX : 0,
    y: maxY > 0 ? normalized.y + deltaY / maxY : 0,
  })
}
