import { normalizeBeadProjectData } from './beads/compat'
import type { BeadPatternGrid } from './beads/types'

export type StudioReviewMetadata = {
  width: number | null
  height: number | null
  totalBeads: number
  colorCount: number
}

export function extractStudioReviewPattern(data: unknown): BeadPatternGrid | null {
  return normalizeBeadProjectData(data)?.pattern || null
}

export function getStudioReviewMetadata(pattern: BeadPatternGrid | null): StudioReviewMetadata {
  if (!pattern) return { width: null, height: null, totalBeads: 0, colorCount: 0 }
  const usedCells = pattern.cells.filter((cell) => cell >= 0 && Boolean(pattern.palette[cell]))
  return {
    width: pattern.width,
    height: pattern.height,
    totalBeads: usedCells.length,
    colorCount: new Set(usedCells).size,
  }
}

export function getStudioReviewPaletteLabel(pattern: BeadPatternGrid | null) {
  const first = pattern?.palette.find((color) => color.brand && color.series)
  return first ? `${first.brand} ${first.series}` : '—'
}
