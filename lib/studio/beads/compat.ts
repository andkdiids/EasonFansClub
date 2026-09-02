import { getPalette, getSeriesForBrand, isPaletteMode, supportedBeadBrands } from './palette'
import { paletteColor } from './color'
import type { BeadBrand, BeadLayer, BeadLayerStack, BeadPaletteColor, BeadPaletteMode, BeadPatternGrid, BeadProjectData, BeadReferenceLayer, BeadSettings } from './types'
import { CURRENT_BEAD_PROJECT_VERSION, EMPTY_CELL, MAX_BEAD_DIMENSION } from './types'

const LEGACY_MAX_BEAD_DIMENSION = 200
const PALETTE_MAX_SIZE = 221
const SAFE_IMAGE_URL = /^(?:https?:\/\/|\/|blob:)/i

export const defaultBeadSettings: BeadSettings = {
  imageType: 'cartoon',
  width: 29,
  height: 29,
  lockRatio: true,
  cropRatio: '1:1',
  cropZoom: 1,
  cropX: 0,
  cropY: 0,
  rotation: 0,
  brand: 'MARD',
  series: '221',
  paletteMode: 'standard',
  matchingMode: 'balanced',
  maxColors: 16,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  whiteAsEmpty: false,
  removeBackground: false,
  backgroundTolerance: 28,
  dithering: 'none',
  cleanupThreshold: 3,
}

export function isValidBeadDimensions(width: number, height: number, allowLegacy = false) {
  const max = allowLegacy ? LEGACY_MAX_BEAD_DIMENSION : MAX_BEAD_DIMENSION
  return Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= max && height <= max
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, number))
}

function integerInRange(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(numberInRange(value, fallback, min, max))
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function paletteSource(value: unknown): BeadPaletteColor['source'] {
  return value === 'verified' || value === 'unknown' ? value : 'existing'
}

function validHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.trim())
}

function normalizePalette(rawPalette: unknown, settings: BeadSettings) {
  if (!Array.isArray(rawPalette) || rawPalette.length < 1 || rawPalette.length > PALETTE_MAX_SIZE) return null
  const fallbackPalette = getPalette(settings.brand, settings.series, settings.paletteMode)
  const palette: BeadPaletteColor[] = []
  for (const [index, value] of rawPalette.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>
    const code = stringValue(raw.code, fallbackPalette[index]?.code || `LEGACY-${index + 1}`)
    const hex = validHex(raw.hex) ? raw.hex.trim() : fallbackPalette[index]?.hex
    if (!hex) return null
    const brand = stringValue(raw.brand, settings.brand)
    const series = stringValue(raw.series, settings.series)
    const generated = paletteColor(brand, series, code, stringValue(raw.name, code), hex)
    const originalCode = typeof raw.originalCode === 'string' && raw.originalCode.trim() ? raw.originalCode.trim() : undefined
    const displayCode = typeof raw.displayCode === 'string' && raw.displayCode.trim() ? raw.displayCode.trim() : undefined
    palette.push({
      ...generated,
      brandCode: stringValue(raw.brandCode, code),
      ...(originalCode ? { originalCode } : {}),
      ...(displayCode ? { displayCode } : {}),
      enabled: raw.enabled !== false,
      groups: Array.isArray(raw.groups) ? raw.groups.filter((group): group is string => typeof group === 'string').map((group) => group.trim()).filter(Boolean) : [],
      source: paletteSource(raw.source),
    })
  }
  return palette
}

function safeImageUrl(value: unknown) {
  return typeof value === 'string' && SAFE_IMAGE_URL.test(value.trim()) ? value.trim() : null
}

function normalizeTransform(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    x: numberInRange(raw.x, 0, -100, 100),
    y: numberInRange(raw.y, 0, -100, 100),
    scale: numberInRange(raw.scale, 1, .25, 4),
    rotation: numberInRange(raw.rotation, 0, -180, 180),
  }
}

export function createDefaultLayerStack(): BeadLayerStack {
  const beads: BeadLayer = { id: 'beads', kind: 'beads', name: '拼豆', visible: true, opacity: 100 }
  const reference: BeadReferenceLayer = { id: 'reference', kind: 'reference-image', name: '参考图', visible: true, opacity: 40, imageUrl: null, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  return { version: 1, activeLayerId: 'beads', layers: [beads, reference] }
}

function normalizeLayers(value: unknown, legacyReference: unknown) {
  const defaults = createDefaultLayerStack()
  const stackRecord = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  const rawLayers = Array.isArray(value) ? value : Array.isArray(stackRecord?.layers) ? stackRecord.layers : []
  const rawBeads = rawLayers.find((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).id === 'beads')
  const rawReference = rawLayers.find((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).id === 'reference')
  const beads: BeadLayer = {
    id: 'beads',
    kind: 'beads',
    name: '拼豆',
    visible: rawBeads && typeof rawBeads === 'object' && (rawBeads as Record<string, unknown>).visible === false ? false : true,
    opacity: 100,
  }
  const raw = rawReference && typeof rawReference === 'object' && !Array.isArray(rawReference)
    ? rawReference as Record<string, unknown>
    : legacyReference && typeof legacyReference === 'object' && !Array.isArray(legacyReference)
      ? legacyReference as Record<string, unknown>
      : {}
  const imageUrl = safeImageUrl(raw.imageUrl ?? raw.url)
  const reference: BeadReferenceLayer = {
    id: 'reference',
    kind: 'reference-image',
    name: '参考图',
    visible: raw.visible !== false,
    opacity: integerInRange(raw.opacity, 40, 0, 100),
    imageUrl,
    transform: normalizeTransform(raw.transform || raw),
    ...(Number.isFinite(raw.naturalWidth) ? { naturalWidth: integerInRange(raw.naturalWidth, 0, 0, 12000) } : {}),
    ...(Number.isFinite(raw.naturalHeight) ? { naturalHeight: integerInRange(raw.naturalHeight, 0, 0, 12000) } : {}),
  }
  const activeLayerId = stackRecord?.activeLayerId === 'reference' || rawLayers.some((item) => item && typeof item === 'object' && (item as Record<string, unknown>).id === 'reference' && (item as Record<string, unknown>).active === true) ? 'reference' : 'beads'
  return { ...defaults, activeLayerId, layers: [beads, reference] } satisfies BeadLayerStack
}

function normalizeSettings(value: unknown, patternWidth: number, patternHeight: number) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<BeadSettings> : {}
  const brand = supportedBeadBrands.includes(raw.brand as BeadBrand) ? raw.brand as BeadBrand : defaultBeadSettings.brand
  const seriesOptions = getSeriesForBrand(brand)
  const series = typeof raw.series === 'string' && seriesOptions.includes(raw.series) ? raw.series : seriesOptions[0] || defaultBeadSettings.series
  const paletteMode: BeadPaletteMode = isPaletteMode(raw.paletteMode) ? raw.paletteMode : defaultBeadSettings.paletteMode
  return {
    ...defaultBeadSettings,
    ...raw,
    imageType: raw.imageType === 'photo' ? 'photo' : 'cartoon',
    width: integerInRange(raw.width, patternWidth, 1, Math.max(MAX_BEAD_DIMENSION, patternWidth)),
    height: integerInRange(raw.height, patternHeight, 1, Math.max(MAX_BEAD_DIMENSION, patternHeight)),
    lockRatio: booleanValue(raw.lockRatio, defaultBeadSettings.lockRatio),
    cropRatio: ['free', '1:1', '4:3', '3:4', '16:9', '9:16'].includes(raw.cropRatio as string) ? raw.cropRatio as BeadSettings['cropRatio'] : defaultBeadSettings.cropRatio,
    cropZoom: numberInRange(raw.cropZoom, 1, 1, 2.5),
    cropX: numberInRange(raw.cropX, 0, -100, 100),
    cropY: numberInRange(raw.cropY, 0, -100, 100),
    rotation: numberInRange(raw.rotation, 0, -180, 180),
    brand,
    series,
    paletteMode,
    matchingMode: raw.matchingMode === 'fast' || raw.matchingMode === 'precise' ? raw.matchingMode : 'balanced',
    maxColors: [8, 12, 16, 24, 32, 0].includes(Number(raw.maxColors)) ? Number(raw.maxColors) as BeadSettings['maxColors'] : defaultBeadSettings.maxColors,
    brightness: integerInRange(raw.brightness, 0, -100, 100),
    contrast: integerInRange(raw.contrast, 0, -100, 100),
    saturation: integerInRange(raw.saturation, 0, -100, 100),
    whiteAsEmpty: booleanValue(raw.whiteAsEmpty, false),
    removeBackground: booleanValue(raw.removeBackground, false),
    backgroundTolerance: integerInRange(raw.backgroundTolerance, 28, 0, 255),
    dithering: raw.dithering === 'floyd-steinberg' ? 'floyd-steinberg' : 'none',
    cleanupThreshold: [0, 2, 3, 5, 10].includes(Number(raw.cleanupThreshold)) ? Number(raw.cleanupThreshold) as BeadSettings['cleanupThreshold'] : 3,
  } satisfies BeadSettings
}

/** Normalize both v1 saved projects and current v2 projects without changing the grid semantics. */
export function normalizeBeadProjectData(value: unknown): BeadProjectData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.tool !== 'beads' || (candidate.version !== 1 && candidate.version !== CURRENT_BEAD_PROJECT_VERSION)) return null
  const rawPattern = candidate.pattern
  if (!rawPattern || typeof rawPattern !== 'object' || Array.isArray(rawPattern)) return null
  const patternRecord = rawPattern as Record<string, unknown>
  const width = patternRecord.width
  const height = patternRecord.height
  // v1 projects could be as large as the former 200×200 limit. Once such a
  // project is normalized, keep the explicit marker so a later save does not
  // make the server mistake it for a newly-created oversized project.
  const legacy = candidate.version === 1 || candidate.legacyOversize === true
  if (typeof width !== 'number' || typeof height !== 'number' || !isValidBeadDimensions(width, height, legacy)) return null
  const settings = normalizeSettings(candidate.settings, width, height)
  const palette = normalizePalette(patternRecord.palette, settings)
  const cells = patternRecord.cells
  if (!palette || !Array.isArray(cells) || cells.length !== width * height || (cells.length > MAX_BEAD_DIMENSION * MAX_BEAD_DIMENSION && !legacy)) return null
  if (cells.some((cell) => !Number.isInteger(cell) || cell < EMPTY_CELL || cell >= palette.length)) return null
  const completed = Array.isArray(candidate.completed)
    ? [...new Set(candidate.completed.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < cells.length))]
    : []
  const pattern: BeadPatternGrid = { width, height, palette, cells: [...cells] }
  return {
    version: CURRENT_BEAD_PROJECT_VERSION,
    tool: 'beads',
    settings,
    pattern,
    completed,
    layers: normalizeLayers(candidate.layers, candidate.referenceImage),
    ...(legacy && (width > MAX_BEAD_DIMENSION || height > MAX_BEAD_DIMENSION) ? { legacyOversize: true } : {}),
  }
}

export function referenceLayerFromStack(stack: BeadLayerStack): BeadReferenceLayer {
  const layer = stack.layers.find((item): item is BeadReferenceLayer => item.kind === 'reference-image')
  return layer || createDefaultLayerStack().layers[1] as BeadReferenceLayer
}

export function beadsLayerFromStack(stack: BeadLayerStack) {
  return stack.layers.find((item) => item.id === 'beads') || createDefaultLayerStack().layers[0]
}
