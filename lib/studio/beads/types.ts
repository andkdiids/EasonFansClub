export const EMPTY_CELL = -1

export type BeadRgb = { r: number; g: number; b: number }
export type BeadLab = { L: number; a: number; b: number }

export type BeadPaletteColor = {
  brand: string
  series: string
  code: string
  name: string
  hex: string
  rgb: BeadRgb
  lab: BeadLab
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
  brand: 'MARD' | 'Perler' | 'Hama' | 'Artkal'
  series: string
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
  version: 1
  tool: 'beads'
  settings: BeadSettings
  pattern: BeadPatternGrid
  completed: number[]
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
