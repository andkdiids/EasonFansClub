import { calculateMaterialList, splitIntoBoards } from './grid'
import type { BeadPatternGrid } from './types'
import { EMPTY_CELL } from './types'
import { patternCellColor } from './renderer'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842

function pdfText(value: string) {
  const ascii = value.replace(/[^ -~]/g, '').trim()
  return (ascii || 'Bead Pattern').replace(/([\\()])/g, '\\$1')
}

function rgbCommand(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = ((value >> 16) & 255) / 255
  const g = ((value >> 8) & 255) / 255
  const b = (value & 255) / 255
  return `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`
}

function textLine(text: string, x: number, y: number, size = 11) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfText(text)}) Tj ET`
}

function coverPreview(pattern: BeadPatternGrid) {
  const xStart = 340
  const yTop = 675
  const width = 205
  const height = 175
  const cell = Math.min(width / pattern.width, height / pattern.height)
  const lines = ['0.95 0.96 0.97 rg', `${xStart} ${yTop - pattern.height * cell} ${pattern.width * cell} ${pattern.height * cell} re f`]
  for (let y = 0; y < pattern.height; y += 1) {
    for (let x = 0; x < pattern.width; x += 1) {
      const paletteIndex = pattern.cells[y * pattern.width + x]
      const color = patternCellColor(pattern, paletteIndex)
      if (!color) continue
      const left = xStart + x * cell
      const bottom = yTop - (y + 1) * cell
      lines.push(rgbCommand(color))
      lines.push(`${left.toFixed(2)} ${bottom.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`)
    }
  }
  lines.push('0.25 0.29 0.34 RG 0.5 w')
  for (let x = 0; x <= pattern.width; x += 1) lines.push(`${xStart + x * cell} ${yTop - pattern.height * cell} m ${xStart + x * cell} ${yTop} l S`)
  for (let y = 0; y <= pattern.height; y += 1) lines.push(`${xStart} ${yTop - y * cell} m ${xStart + pattern.width * cell} ${yTop - y * cell} l S`)
  return lines
}

function coverPage(title: string, pattern: BeadPatternGrid) {
  const materials = calculateMaterialList(pattern)
  const lines = [
    textLine('BEETHOVEN & ME / BEADS PATTERN', 48, 790, 18),
    textLine(title, 48, 754, 24),
    textLine(`Size: ${pattern.width} x ${pattern.height} beads`, 48, 712),
    textLine(`Boards: ${materials.boardCount} (${materials.boardColumns} x ${materials.boardRows})`, 48, 690),
    textLine(`Beads: ${materials.totalBeads}    Colors: ${materials.colorCount}`, 48, 668),
    textLine('Materials', 48, 610, 14),
  ]
  lines.push(...coverPreview(pattern))
  materials.materials.slice(0, 28).forEach((material, index) => {
    const column = index > 13 ? 1 : 0
    const row = index % 14
    lines.push(textLine(`${material.code}  ${material.quantity} pcs  / ${material.packs} pack`, 48 + column * 250, 580 - row * 24, 10))
  })
  return lines.join('\n')
}

function boardPage(pattern: BeadPatternGrid, board: ReturnType<typeof splitIntoBoards>[number]) {
  const margin = 48
  const titleY = PAGE_HEIGHT - 46
  const top = PAGE_HEIGHT - 86
  const availableWidth = PAGE_WIDTH - margin * 2
  const availableHeight = top - 62
  const cell = Math.min(availableWidth / board.width, availableHeight / board.height)
  const lines = [
    textLine(`Board ${board.index}   X ${board.xStart + 1}-${board.xEnd}   Y ${board.yStart + 1}-${board.yEnd}`, margin, titleY, 13),
    textLine(`Global coordinates / ${pattern.width} x ${pattern.height}`, margin, titleY - 18, 9),
  ]
  for (let y = 0; y < board.height; y += 1) {
    for (let x = 0; x < board.width; x += 1) {
      const paletteIndex = board.cells[y * board.width + x]
      const left = margin + x * cell
      const bottom = top - (y + 1) * cell
      const color = patternCellColor(pattern, paletteIndex)
      if (color) {
        lines.push(rgbCommand(color))
        lines.push(`${left.toFixed(2)} ${bottom.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`)
      } else {
        lines.push('0.94 0.95 0.96 rg')
        lines.push(`${left.toFixed(2)} ${bottom.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`)
      }
      if (cell >= 11 && paletteIndex !== EMPTY_CELL) {
        const code = pattern.palette[paletteIndex]?.code || ''
        lines.push(`0.15 0.18 0.22 rg ${textLine(code, left + cell * 0.18, bottom + cell * 0.35, Math.min(8, cell * 0.35))}`)
      }
    }
  }
  lines.push('0.25 0.29 0.34 RG 0.4 w')
  for (let x = 0; x <= board.width; x += 1) lines.push(`${margin + x * cell} ${top - board.height * cell} m ${margin + x * cell} ${top} l S`)
  for (let y = 0; y <= board.height; y += 1) lines.push(`${margin} ${top - y * cell} m ${margin + board.width * cell} ${top - y * cell} l S`)
  if (cell >= 12) {
    const coordinateStep = cell >= 16 ? 1 : 5
    for (let x = 0; x < board.width; x += coordinateStep) lines.push(textLine(String(board.xStart + x + 1), margin + x * cell + cell * 0.5, top + 5, Math.min(7, cell * 0.28)))
    for (let y = 0; y < board.height; y += coordinateStep) lines.push(textLine(String(board.yStart + y + 1), margin - 25, top - (y + 0.5) * cell, Math.min(7, cell * 0.28)))
  }
  return lines.join('\n')
}

function buildPdf(pages: string[]) {
  const objects: string[] = []
  const addObject = (value: string) => { objects.push(value); return objects.length }
  const pagesId = addObject('')
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds: number[] = []
  pages.forEach((content) => {
    const contentBytes = new TextEncoder().encode(content)
    const contentId = addObject(`<< /Length ${contentBytes.byteLength} >>\nstream\n${content}\nendstream`)
    pageIds.push(addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`))
  })
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  const encoder = new TextEncoder()
  const header = encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const objectChunks: Uint8Array[] = []
  const offsets = [0]
  let byteOffset = header.byteLength
  objects.forEach((object, index) => {
    const chunk = encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`)
    offsets.push(byteOffset)
    objectChunks.push(chunk)
    byteOffset += chunk.byteLength
  })
  const xrefOffset = byteOffset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => { xref += `${String(offset).padStart(10, '0')} 00000 n \n` })
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  const tail = encoder.encode(xref)
  const output = new Uint8Array(header.byteLength + objectChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) + tail.byteLength)
  let cursor = 0
  for (const chunk of [header, ...objectChunks, tail]) {
    output.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  return output
}

export function createBeadPatternPdf(pattern: BeadPatternGrid, title: string) {
  const pages = [coverPage(title, pattern), ...splitIntoBoards(pattern).map((board) => boardPage(pattern, board))]
  return new Blob([buildPdf(pages)], { type: 'application/pdf' })
}
