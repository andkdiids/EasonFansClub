export const EMPTY_CELL = -1
export const MAX_BEAD_DIMENSION = 102
export const CURRENT_BEAD_PROJECT_VERSION = 2

export type BeadRgb = { r: number; g: number; b: number }
export type BeadLab = { L: number; a: number; b: number }
export type BeadBrand = 'MARD' | 'Perler' | 'Hama' | 'Artkal'
export type BeadPaletteMode = 'standard' | 'expert' | 'complete'
export type BeadPaletteSource = 'existing' | 'verified' | 'unknown'

export type BeadPaletteColor = {
  brand: string
  brandCode?: string
  /** Brand-native code as printed by the source catalogue (for example A1). */
  originalCode?: string
  /** Canonical code exposed by the current editor (for example A01). */
  displayCode?: string
  series: string
  code: string
  name: string
  hex: string
  rgb: BeadRgb
  lab: BeadLab
  enabled: boolean
  groups: string[]
  source: BeadPaletteSource
}

export type BeadPatternGrid = {
  width: number
  height: number
  palette: BeadPaletteColor[]
  cells: number[]
}

export type BeadSettings = {
  imageType: 'cartoon' | 'photo'
  width: number
  height: number
  lockRatio: boolean
  cropRatio: 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'
  cropZoom: number
  cropX: number
  cropY: number
  rotation: number
  brand: BeadBrand
  series: string
  paletteMode: BeadPaletteMode
  matchingMode: 'fast' | 'balanced' | 'precise'
  maxColors: 8 | 12 | 16 | 24 | 32 | 0
  brightness: number
  contrast: number
  saturation: number
  whiteAsEmpty: boolean
  removeBackground: boolean
  backgroundTolerance: number
  dithering: 'none' | 'floyd-steinberg'
  cleanupThreshold: 0 | 2 | 3 | 5 | 10
}

export type BeadProjectData = {
  version: typeof CURRENT_BEAD_PROJECT_VERSION
  tool: 'beads'
  settings: BeadSettings
  pattern: BeadPatternGrid
  completed: number[]
  layers: BeadLayerStack
  /** Only set when a pre-v2 project used the former 200×200 limit. */
  legacyOversize?: boolean
}

export type BeadLayerTransform = {
  x: number
  y: number
  scale: number
  rotation: number
}

export type BeadGridLayer = {
  id: 'beads'
  kind: 'beads'
  name: '拼豆'
  visible: boolean
  opacity: 100
}

export type BeadReferenceLayer = {
  id: 'reference'
  kind: 'reference-image'
  name: '参考图'
  visible: boolean
  opacity: number
  imageUrl: string | null
  transform: BeadLayerTransform
  naturalWidth?: number
  naturalHeight?: number
}

export type BeadLayer = BeadGridLayer | BeadReferenceLayer

export type BeadLayerStack = {
  version: 1
  activeLayerId: BeadLayer['id']
  layers: BeadLayer[]
}

export type BeadMaterial = BeadPaletteColor & {
  index: number
  quantity: number
  percentage: number
  packs: number
}

export type BeadMaterialSummary = {
  width: number
  height: number
  boardColumns: number
  boardRows: number
  boardCount: number
  totalCells: number
  totalBeads: number
  emptyCells: number
  colorCount: number
  materials: BeadMaterial[]
}
