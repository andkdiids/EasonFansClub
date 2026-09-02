import type { BeadMaterial, BeadMaterialSummary, BeadPaletteColor, BeadPatternGrid } from './types'
import { EMPTY_CELL, MAX_BEAD_DIMENSION } from './types'

export function createDemoPattern(palette: BeadPaletteColor[], width = 29, height = 29): BeadPatternGrid {
  width = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(width)))
  height = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(height)))
  const cells = new Array<number>(width * height).fill(EMPTY_CELL)
  const set = (x: number, y: number, color: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) cells[y * width + x] = color
  }
  const centerX = (width - 1) / 2
  for (let y = 3; y < height - 3; y += 1) {
    for (let x = 3; x < width - 3; x += 1) {
      const distance = Math.abs(x - centerX) / Math.max(1, width / 2)
      if (y < height * 0.72 && distance < 0.72 - y / height * 0.18) {
        const color = y < height * 0.18 ? 3 : distance > 0.53 ? 5 : 14
        set(x, y, color)
      }
    }
  }
  const note = [
    [13, 10], [14, 10], [15, 10], [16, 10], [16, 11], [16, 12], [16, 13], [15, 14], [14, 14], [13, 13], [13, 12],
    [18, 17], [19, 17], [20, 17], [20, 18], [20, 19], [19, 20], [18, 20], [17, 19], [18, 18],
  ]
  note.forEach(([x, y], index) => set(x, y, index % 3 === 0 ? 9 : 4))
  for (let x = 5; x < width - 5; x += 1) {
    set(x, Math.round(height * 0.76), x % 3 === 0 ? 9 : 4)
  }
  return { width, height, palette, cells }
}

export function calculateMaterialList(pattern: BeadPatternGrid, packSize = 500): BeadMaterialSummary {
  const counts = new Map<number, number>()
  pattern.cells.forEach((cell) => {
    if (cell !== EMPTY_CELL && pattern.palette[cell]) counts.set(cell, (counts.get(cell) || 0) + 1)
  })
  const totalBeads = [...counts.values()].reduce((sum, value) => sum + value, 0)
  const materials: BeadMaterial[] = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || (pattern.palette[left[0]]?.code || '').localeCompare(pattern.palette[right[0]]?.code || ''))
    .map(([index, quantity]) => ({
      ...pattern.palette[index],
      index,
      quantity,
      percentage: totalBeads ? quantity / totalBeads * 100 : 0,
      packs: Math.ceil(quantity / Math.max(1, packSize)),
    }))
  const boardColumns = Math.ceil(pattern.width / 29)
  const boardRows = Math.ceil(pattern.height / 29)
  return {
    width: pattern.width,
    height: pattern.height,
    boardColumns,
    boardRows,
    boardCount: boardColumns * boardRows,
    totalCells: pattern.cells.length,
    totalBeads,
    emptyCells: pattern.cells.length - totalBeads,
    colorCount: materials.length,
    materials,
  }
}

export function replaceColor(cells: readonly number[], from: number, to: number) {
  return cells.map((cell) => cell === from ? to : cell)
}

export function floodFill(cells: readonly number[], width: number, height: number, startIndex: number, replacement: number) {
  if (startIndex < 0 || startIndex >= cells.length) return [...cells]
  const target = cells[startIndex]
  if (target === replacement) return [...cells]
  const next = [...cells]
  const queue = [startIndex]
  let queueIndex = 0
  next[startIndex] = replacement
  while (queueIndex < queue.length) {
    const index = queue[queueIndex]
    queueIndex += 1
    const x = index % width
    const y = Math.floor(index / width)
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ]
    neighbors.forEach((neighbor) => {
      if (neighbor >= 0 && next[neighbor] === target) {
        next[neighbor] = replacement
        queue.push(neighbor)
      }
    })
  }
  return next
}

export function removeTinyColorRegions(cells: readonly number[], width: number, height: number, threshold: number) {
  if (threshold <= 0) return [...cells]
  const next = [...cells]
  const visited = new Set<number>()
  for (let index = 0; index < next.length; index += 1) {
    if (visited.has(index) || next[index] === EMPTY_CELL) continue
    const color = next[index]
    const region: number[] = []
    const queue = [index]
    let queueIndex = 0
    visited.add(index)
    while (queueIndex < queue.length) {
      const current = queue[queueIndex]
      queueIndex += 1
      region.push(current)
      const x = current % width
      const y = Math.floor(current / width)
      const neighbors = [x > 0 ? current - 1 : -1, x < width - 1 ? current + 1 : -1, y > 0 ? current - width : -1, y < height - 1 ? current + width : -1]
      neighbors.forEach((neighbor) => {
        if (neighbor >= 0 && !visited.has(neighbor) && next[neighbor] === color) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      })
    }
    if (region.length > threshold) continue
    const neighborCounts = new Map<number, number>()
    region.forEach((current) => {
      const x = current % width
      const y = Math.floor(current / width)
      const neighbors = [x > 0 ? current - 1 : -1, x < width - 1 ? current + 1 : -1, y > 0 ? current - width : -1, y < height - 1 ? current + width : -1]
      neighbors.forEach((neighbor) => {
        const neighborColor = neighbor >= 0 ? next[neighbor] : EMPTY_CELL
        if (neighborColor !== color && neighborColor !== EMPTY_CELL) neighborCounts.set(neighborColor, (neighborCounts.get(neighborColor) || 0) + 1)
      })
    })
    const replacement = [...neighborCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
    if (replacement !== undefined) region.forEach((current) => { next[current] = replacement })
  }
  return next
}

export type BoardSlice = {
  index: number
  column: number
  row: number
  xStart: number
  xEnd: number
  yStart: number
  yEnd: number
  width: number
  height: number
  cells: number[]
}

export function splitIntoBoards(pattern: BeadPatternGrid): BoardSlice[] {
  const columns = Math.ceil(pattern.width / 29)
  const rows = Math.ceil(pattern.height / 29)
  const boards: BoardSlice[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const xStart = column * 29
      const yStart = row * 29
      const width = Math.min(29, pattern.width - xStart)
      const height = Math.min(29, pattern.height - yStart)
      const cells: number[] = []
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) cells.push(pattern.cells[(yStart + y) * pattern.width + xStart + x])
      }
      boards.push({ index: boards.length + 1, column, row, xStart, xEnd: xStart + width, yStart, yEnd: yStart + height, width, height, cells })
    }
  }
  return boards
}
