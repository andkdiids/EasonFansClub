import QRCode from 'qrcode'

/** Bump when the QR logo treatment, quiet zone, or module styling changes. */
export const BRANDED_QR_VERSION = 'v1'
export const BRANDED_QR_ERROR_CORRECTION = 'H' as const
export const BRANDED_QR_MARGIN_MODULES = 4
export const BRANDED_QR_DARK_COLOR = '#071523'
export const BRANDED_QR_LIGHT_COLOR = '#ffffff'
export const BRANDED_QR_LOGO_PATH = '/icon.png'
/** The logo remains small enough for H-level error correction to recover. */
export const BRANDED_QR_LOGO_RATIO = 0.18
export const BRANDED_QR_LOGO_PLATE_PADDING_PX = 12

export type BrandedQrOptions = Readonly<{
  /** Defaults to the public official Logo path. Server renderers pass a data URI. */
  logoHref?: string | null
  /** A tiny QR should not be made harder to scan by forcing a large logo. */
  includeLogo?: boolean
}>

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character)
}

function safeSize(size: number) {
  if (!Number.isFinite(size) || size < 1) throw new Error('BRANDED_QR_SIZE_INVALID')
  return Math.max(1, Math.round(size))
}

/**
 * Build the same QR module matrix for every consumer. The SVG is deliberately
 * generated here instead of letting each UI call qrcode with its own options.
 */
export function createBrandedQrSvg(payload: string, size: number, options: BrandedQrOptions = {}) {
  const outputSize = safeSize(size)
  const code = QRCode.create(payload, { errorCorrectionLevel: BRANDED_QR_ERROR_CORRECTION })
  const moduleCount = code.modules.size
  const margin = BRANDED_QR_MARGIN_MODULES
  const viewBoxSize = moduleCount + margin * 2
  const moduleMarkup: string[] = []
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (code.modules.get(row, column)) {
        moduleMarkup.push(`<rect x="${column + margin}" y="${row + margin}" width="1" height="1"/>`)
      }
    }
  }

  const includeLogo = options.includeLogo !== false && outputSize >= 120 && options.logoHref !== null
  const logoSizePx = Math.round(outputSize * BRANDED_QR_LOGO_RATIO)
  const moduleScale = outputSize / viewBoxSize
  const logoModules = logoSizePx / moduleScale
  const plateModules = (logoSizePx + BRANDED_QR_LOGO_PLATE_PADDING_PX) / moduleScale
  const center = viewBoxSize / 2
  const logoX = center - logoModules / 2
  const logoY = center - logoModules / 2
  const plateX = center - plateModules / 2
  const plateY = center - plateModules / 2
  const logoMarkup = includeLogo
    ? `<rect x="${plateX}" y="${plateY}" width="${plateModules}" height="${plateModules}" rx="${Math.min(plateModules / 2, 1.5)}" fill="${BRANDED_QR_LIGHT_COLOR}"/><image href="${escapeXml(options.logoHref || BRANDED_QR_LOGO_PATH)}" x="${logoX}" y="${logoY}" width="${logoModules}" height="${logoModules}" preserveAspectRatio="xMidYMid meet"/>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${outputSize}" height="${outputSize}" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges"><rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${BRANDED_QR_LIGHT_COLOR}"/><g fill="${BRANDED_QR_DARK_COLOR}">${moduleMarkup.join('')}</g>${logoMarkup}</svg>`
}

/** Browser-safe data URL used by Canvas consumers and preview fallback. */
export function createBrandedQrDataUrl(payload: string, size: number, options: BrandedQrOptions = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(createBrandedQrSvg(payload, size, options))}`
}

