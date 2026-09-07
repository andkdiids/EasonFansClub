import type { BeadPatternGrid } from './types'
import { EMPTY_CELL } from './types'

export type BeadRenderOptions = {
  beadMode?: boolean
  displayGrid?: boolean
  displayCodes?: boolean
  displayCoordinates?: boolean
  transparentBackground?: boolean
  /** Render into a larger offscreen bitmap while keeping logical layout coordinates. */
  renderScale?: number
  completed?: ReadonlySet<number>
  activeColorIndex?: number | null
  selection?: { xStart: number; yStart: number; xEnd: number; yEnd: number } | null
}

export const BEAD_GRID_DIVIDER_COLOR = 'rgba(16, 64, 99, .76)'
export const BEAD_GRID_NORMAL_COLOR = 'rgba(31, 44, 58, .18)'
export const BEAD_GRID_DIVIDER_LINE_WIDTH = 1.35
export const BEAD_GRID_NORMAL_LINE_WIDTH = 1
export const DEFAULT_BEAD_EXPORT_SCALE = 4
export const MAX_BEAD_RENDER_DIMENSION = 16_384
export const MAX_BEAD_RENDER_PIXELS = 100_000_000

export function safeRenderScale(logicalWidth: number, logicalHeight: number, preferredScale = 1) {
  const width = Math.max(1, logicalWidth)
  const height = Math.max(1, logicalHeight)
  const requested = Number.isFinite(preferredScale) ? Math.max(0.25, preferredScale) : 1
  const dimensionLimit = Math.min(MAX_BEAD_RENDER_DIMENSION / width, MAX_BEAD_RENDER_DIMENSION / height)
  const pixelLimit = Math.sqrt(MAX_BEAD_RENDER_PIXELS / (width * height))
  return Math.max(Number.EPSILON, Math.min(requested, dimensionLimit, pixelLimit))
}

function luminance(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return (r * 299 + g * 587 + b * 114) / 1000
}

export function patternCellSize(width: number, height: number) {
  const longest = Math.max(width, height)
  if (longest <= 29) return 24
  if (longest <= 58) return 16
  if (longest <= 87) return 11
  if (longest <= 150) return 7
  return 5
}

export function patternCellColor(pattern: BeadPatternGrid, paletteIndex: number) {
  if (paletteIndex === EMPTY_CELL) return null
  return pattern.palette[paletteIndex]?.hex || null
}

export function renderPatternToCanvas(canvas: HTMLCanvasElement, pattern: BeadPatternGrid, options: BeadRenderOptions = {}) {
  const cellSize = patternCellSize(pattern.width, pattern.height)
  const logicalWidth = pattern.width * cellSize
  const logicalHeight = pattern.height * cellSize
  const scale = safeRenderScale(logicalWidth, logicalHeight, options.renderScale)
  canvas.width = Math.max(1, Math.ceil(logicalWidth * scale))
  canvas.height = Math.max(1, Math.ceil(logicalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return { cellSize, scale, logicalWidth, logicalHeight }
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (scale !== 1) context.scale(scale, scale)
  if (!options.transparentBackground) {
    context.fillStyle = '#f7f8fa'
    context.fillRect(0, 0, logicalWidth, logicalHeight)
  }
  const completed = options.completed || new Set<number>()
  const renderedCellSize = cellSize * scale
  for (let y = 0; y < pattern.height; y += 1) {
    for (let x = 0; x < pattern.width; x += 1) {
      const index = y * pattern.width + x
      const paletteIndex = pattern.cells[index]
      const left = x * cellSize
      const top = y * cellSize
      const color = patternCellColor(pattern, paletteIndex) || '#edf0f2'
      const isDimmed = options.activeColorIndex !== null && options.activeColorIndex !== undefined && paletteIndex !== EMPTY_CELL && paletteIndex !== options.activeColorIndex
      context.globalAlpha = isDimmed ? 0.2 : 1
      context.fillStyle = color
      if (options.beadMode && paletteIndex !== EMPTY_CELL) {
        context.beginPath()
        context.arc(left + cellSize / 2, top + cellSize / 2, Math.max(2, cellSize * 0.42), 0, Math.PI * 2)
        context.fill()
        context.strokeStyle = 'rgba(0,0,0,.14)'
        context.lineWidth = Math.max(1, cellSize / 12)
        context.stroke()
      } else if (!options.transparentBackground || paletteIndex !== EMPTY_CELL) {
        context.fillRect(left, top, cellSize, cellSize)
      }
      context.globalAlpha = 1
      if (completed.has(index) && paletteIndex !== EMPTY_CELL) {
        context.fillStyle = 'rgba(255,255,255,.26)'
        context.fillRect(left, top, cellSize, cellSize)
        context.strokeStyle = 'rgba(18,93,69,.8)'
        context.lineWidth = Math.max(1.5, cellSize / 9)
        context.beginPath()
        context.moveTo(left + cellSize * 0.24, top + cellSize * 0.52)
        context.lineTo(left + cellSize * 0.45, top + cellSize * 0.72)
        context.lineTo(left + cellSize * 0.78, top + cellSize * 0.29)
        context.stroke()
      }
      if (options.displayCodes && paletteIndex !== EMPTY_CELL && renderedCellSize >= 12) {
        const code = pattern.palette[paletteIndex]?.code || ''
        context.fillStyle = luminance(color) > 160 ? '#1f2933' : '#fff'
        context.font = `700 ${Math.max(6 / scale, Math.floor(cellSize * 0.32))}px Arial`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(code, left + cellSize / 2, top + cellSize / 2 + 0.5)
      }
    }
  }
  if (options.displayGrid !== false) {
    for (let x = 0; x <= pattern.width; x += 1) {
      context.strokeStyle = x % 5 === 0 ? BEAD_GRID_DIVIDER_COLOR : BEAD_GRID_NORMAL_COLOR
      context.lineWidth = x % 5 === 0 ? BEAD_GRID_DIVIDER_LINE_WIDTH : BEAD_GRID_NORMAL_LINE_WIDTH
      context.beginPath()
      context.moveTo(x * cellSize + 0.5, 0)
      context.lineTo(x * cellSize + 0.5, logicalHeight)
      context.stroke()
    }
    for (let y = 0; y <= pattern.height; y += 1) {
      context.strokeStyle = y % 5 === 0 ? BEAD_GRID_DIVIDER_COLOR : BEAD_GRID_NORMAL_COLOR
      context.lineWidth = y % 5 === 0 ? BEAD_GRID_DIVIDER_LINE_WIDTH : BEAD_GRID_NORMAL_LINE_WIDTH
      context.beginPath()
      context.moveTo(0, y * cellSize + 0.5)
      context.lineTo(logicalWidth, y * cellSize + 0.5)
      context.stroke()
    }
  }
  if (options.displayCoordinates && cellSize * scale >= 8) {
    context.fillStyle = '#52606d'
    context.font = `700 ${Math.max(7 / scale, Math.floor(cellSize * 0.3))}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'top'
    const coordinateStep = cellSize * scale >= 12 ? 1 : 5
    for (let x = 0; x < pattern.width; x += coordinateStep) context.fillText(String(x + 1), x * cellSize + cellSize / 2, 2)
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    for (let y = 0; y < pattern.height; y += coordinateStep) context.fillText(String(y + 1), 2, y * cellSize + cellSize / 2)
  }
  if (options.selection) {
    const selection = options.selection
    const xStart = Math.max(0, Math.min(selection.xStart, selection.xEnd))
    const yStart = Math.max(0, Math.min(selection.yStart, selection.yEnd))
    const xEnd = Math.min(pattern.width - 1, Math.max(selection.xStart, selection.xEnd))
    const yEnd = Math.min(pattern.height - 1, Math.max(selection.yStart, selection.yEnd))
    if (xStart <= xEnd && yStart <= yEnd) {
      context.fillStyle = 'rgba(23, 105, 223, .12)'
      context.fillRect(xStart * cellSize, yStart * cellSize, (xEnd - xStart + 1) * cellSize, (yEnd - yStart + 1) * cellSize)
      context.strokeStyle = '#1769df'
      context.lineWidth = Math.max(2, cellSize / 7)
      context.setLineDash([Math.max(3, cellSize / 2), Math.max(2, cellSize / 3)])
      context.strokeRect(xStart * cellSize + context.lineWidth / 2, yStart * cellSize + context.lineWidth / 2, (xEnd - xStart + 1) * cellSize - context.lineWidth, (yEnd - yStart + 1) * cellSize - context.lineWidth)
      context.setLineDash([])
    }
  }
  context.globalAlpha = 1
  return { cellSize, scale, logicalWidth, logicalHeight }
}

export function renderPatternToDataUrl(pattern: BeadPatternGrid, options: BeadRenderOptions = {}) {
  const canvas = document.createElement('canvas')
  renderPatternToCanvas(canvas, pattern, options)
  return canvas.toDataURL('image/png')
}
