import { formatUid } from '@/lib/uid'

export const SALON_WATERMARK_POSITIONS = [
  'TOP',
  'BOTTOM',
  'LEFT',
  'RIGHT',
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
] as const

export type SalonWatermarkPosition = typeof SALON_WATERMARK_POSITIONS[number]

export const SALON_DEFAULT_WATERMARK_OPACITY = 50
export const SALON_MIN_WATERMARK_OPACITY = 10
export const SALON_MAX_WATERMARK_OPACITY = 100

export function parseSalonWatermarkPosition(value: unknown): SalonWatermarkPosition {
  return typeof value === 'string' && SALON_WATERMARK_POSITIONS.includes(value as SalonWatermarkPosition)
    ? value as SalonWatermarkPosition
    : 'BOTTOM_RIGHT'
}

export function clampSalonWatermarkOpacity(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return SALON_DEFAULT_WATERMARK_OPACITY
  return Math.min(SALON_MAX_WATERMARK_OPACITY, Math.max(SALON_MIN_WATERMARK_OPACITY, Math.round(numeric)))
}

export function createSalonWatermarkText(uid: number | string, nickname: string | null | undefined) {
  const publicUid = formatUid(uid)
  const publicNickname = (nickname || 'E院用户').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 32) || 'E院用户'
  return `${publicUid} · ${publicNickname}`
}

export type SalonWatermarkRenderOptions = Readonly<{
  text: string
  opacity: number
  position: SalonWatermarkPosition
}>

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character)
}

function estimatedTextWidth(value: string, fontSize: number) {
  return Array.from(value).reduce((total, character) => total + (/^[\x00-\x7f]$/u.test(character) ? fontSize * 0.58 : fontSize), 0)
}

export function calculateSalonWatermarkLayout(width: number, height: number, options: SalonWatermarkRenderOptions) {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const shortEdge = Math.min(safeWidth, safeHeight)
  const padding = Math.min(96, Math.max(16, Math.round(shortEdge * 0.04)))
  const maxTextWidth = Math.max(1, safeWidth - padding * 2)
  let fontSize = Math.min(56, Math.max(16, Math.round(shortEdge * 0.035)))
  while (fontSize > 14 && estimatedTextWidth(options.text, fontSize) > maxTextWidth) fontSize -= 1
  const textWidth = Math.min(maxTextWidth, estimatedTextWidth(options.text, fontSize))
  const horizontal = options.position === 'LEFT' || options.position === 'TOP_LEFT' || options.position === 'BOTTOM_LEFT'
    ? 'left'
    : options.position === 'RIGHT' || options.position === 'TOP_RIGHT' || options.position === 'BOTTOM_RIGHT'
      ? 'right'
      : 'center'
  const vertical = options.position === 'TOP' || options.position === 'TOP_LEFT' || options.position === 'TOP_RIGHT'
    ? 'top'
    : options.position === 'BOTTOM' || options.position === 'BOTTOM_LEFT' || options.position === 'BOTTOM_RIGHT'
      ? 'bottom'
      : 'center'
  return {
    width: safeWidth,
    height: safeHeight,
    padding,
    fontSize,
    textWidth,
    x: horizontal === 'left' ? padding : horizontal === 'right' ? safeWidth - padding : safeWidth / 2,
    y: vertical === 'top' ? padding + fontSize / 2 : vertical === 'bottom' ? safeHeight - padding - fontSize / 2 : safeHeight / 2,
    textAnchor: horizontal === 'left' ? 'start' : horizontal === 'right' ? 'end' : 'middle',
  } as const
}

/** Build a transparent SVG overlay with a responsive, safely inset watermark. */
export function createSalonWatermarkSvg(width: number, height: number, options: SalonWatermarkRenderOptions) {
  const layout = calculateSalonWatermarkLayout(width, height, options)
  const opacity = Math.min(SALON_MAX_WATERMARK_OPACITY, Math.max(SALON_MIN_WATERMARK_OPACITY, Math.round(options.opacity))) / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><text x="${layout.x}" y="${layout.y}" text-anchor="${layout.textAnchor}" dominant-baseline="middle" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${layout.fontSize}px" font-weight="700" fill="#fff" fill-opacity="${opacity}" stroke="#000" stroke-opacity="0.52" stroke-width="${Math.max(1, Math.round(layout.fontSize * 0.08))}" paint-order="stroke" stroke-linejoin="round"${layout.textWidth > 0 ? ` textLength="${layout.textWidth.toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : ''}>${escapeXml(options.text)}</text></svg>`
}
