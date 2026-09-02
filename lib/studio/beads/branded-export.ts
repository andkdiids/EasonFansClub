'use client'

import { drawBrandedQrToCanvas } from '@/lib/branded-qr-client'
import { shareCardQrPayload } from '@/lib/share-card'
import { calculateMaterialList } from './grid'
import { patternCellColor } from './renderer'
import type { BeadPatternGrid } from './types'
import { EMPTY_CELL } from './types'

const EXPORT_WIDTH = 2200
const EXPORT_MARGIN = 120
const EXPORT_HEADER_HEIGHT = 300
const EXPORT_QR_SIZE = 220
const MATERIAL_ROW_HEIGHT = 58
const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'

type LoadedImage = HTMLImageElement | null

export type BrandedBeadExportInput = Readonly<{
  pattern: BeadPatternGrid
  title: string
  projectUrl: string
}>

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('BEAD_EXPORT_IMAGE_UNAVAILABLE'))
    image.src = source
  })
}

async function loadLogo(): Promise<LoadedImage> {
  try {
    return await loadImage(new URL('/icon.png', window.location.origin).toString())
  } catch {
    return null
  }
}

function drawImageContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, padding = 0) {
  const scale = Math.min((width - padding * 2) / image.naturalWidth, (height - padding * 2) / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

function drawText(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = '#102033', weight = 600) {
  context.font = `${weight} ${size}px ${FONT_STACK}`
  context.fillStyle = color
  context.fillText(value, x, y)
}

function luminance(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return (r * 299 + g * 587 + b * 114) / 1000
}

function safeTitle(value: string) {
  return value.trim() || '未命名图纸'
}

function paletteLabel(pattern: BeadPatternGrid) {
  const color = pattern.palette.find((item) => item.brand && item.series)
  return color ? `${color.brand} ${color.series}` : 'MARD 221'
}

function drawFallbackLogo(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.fillStyle = '#0f5f8f'
  context.fillRect(x, y, size, size)
  context.fillStyle = '#ffffff'
  context.font = `900 ${Math.round(size * 0.46)}px ${FONT_STACK}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('E', x + size / 2, y + size / 2)
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
}

function drawPatternGrid(context: CanvasRenderingContext2D, pattern: BeadPatternGrid, x: number, y: number) {
  const longest = Math.max(1, pattern.width, pattern.height)
  const availableWidth = EXPORT_WIDTH - EXPORT_MARGIN * 2
  const cellSize = Math.max(12, Math.min(36, Math.floor(availableWidth / longest)))
  const width = pattern.width * cellSize
  const height = pattern.height * cellSize
  context.fillStyle = '#f7f8fa'
  context.fillRect(x, y, width, height)

  for (let row = 0; row < pattern.height; row += 1) {
    for (let column = 0; column < pattern.width; column += 1) {
      const paletteIndex = pattern.cells[row * pattern.width + column]
      const color = patternCellColor(pattern, paletteIndex) || '#edf0f2'
      context.fillStyle = color
      context.fillRect(x + column * cellSize, y + row * cellSize, cellSize, cellSize)
      if (paletteIndex !== EMPTY_CELL && cellSize >= 12) {
        const code = pattern.palette[paletteIndex]?.code || ''
        context.fillStyle = luminance(color) > 160 ? '#1f2933' : '#ffffff'
        context.font = `700 ${Math.max(8, Math.floor(cellSize * 0.3))}px Arial, sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(code, x + column * cellSize + cellSize / 2, y + row * cellSize + cellSize / 2)
      }
    }
  }

  for (let column = 0; column <= pattern.width; column += 1) {
    context.strokeStyle = column % 29 === 0 ? 'rgba(16, 64, 99, .76)' : column % 5 === 0 ? 'rgba(31, 44, 58, .38)' : 'rgba(31, 44, 58, .18)'
    context.lineWidth = column % 29 === 0 ? 2.2 : column % 5 === 0 ? 1.35 : 1
    context.beginPath()
    context.moveTo(x + column * cellSize + .5, y)
    context.lineTo(x + column * cellSize + .5, y + height)
    context.stroke()
  }
  for (let row = 0; row <= pattern.height; row += 1) {
    context.strokeStyle = row % 29 === 0 ? 'rgba(16, 64, 99, .76)' : row % 5 === 0 ? 'rgba(31, 44, 58, .38)' : 'rgba(31, 44, 58, .18)'
    context.lineWidth = row % 29 === 0 ? 2.2 : row % 5 === 0 ? 1.35 : 1
    context.beginPath()
    context.moveTo(x, y + row * cellSize + .5)
    context.lineTo(x + width, y + row * cellSize + .5)
    context.stroke()
  }

  const coordinateStep = cellSize >= 18 ? 1 : 5
  context.fillStyle = '#52606d'
  context.font = `700 ${Math.max(11, Math.min(18, Math.floor(cellSize * .35)))}px Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'bottom'
  for (let column = 0; column < pattern.width; column += coordinateStep) context.fillText(String(column + 1), x + column * cellSize + cellSize / 2, y - 8)
  context.textAlign = 'right'
  context.textBaseline = 'middle'
  for (let row = 0; row < pattern.height; row += coordinateStep) context.fillText(String(row + 1), x - 12, y + row * cellSize + cellSize / 2)
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  return { width, height }
}

async function renderBrandedBeadPattern(input: BrandedBeadExportInput) {
  const { pattern } = input
  const title = safeTitle(input.title)
  const materials = calculateMaterialList(pattern)
  const logo = await loadLogo()
  const qrCanvas = document.createElement('canvas')
  await drawBrandedQrToCanvas(qrCanvas, shareCardQrPayload(input.projectUrl), EXPORT_QR_SIZE)
  const grid = drawPatternGrid
  const longest = Math.max(1, pattern.width, pattern.height)
  const cellSize = Math.max(12, Math.min(36, Math.floor((EXPORT_WIDTH - EXPORT_MARGIN * 2) / longest)))
  const gridHeight = pattern.height * cellSize
  const materialTop = EXPORT_HEADER_HEIGHT + gridHeight + 92
  const columnCount = 4
  const rows = Math.max(1, Math.ceil(materials.materials.length / columnCount))
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_WIDTH
  canvas.height = materialTop + rows * MATERIAL_ROW_HEIGHT + EXPORT_MARGIN
  const context = canvas.getContext('2d')
  if (!context) throw new Error('BEAD_EXPORT_CANVAS_CONTEXT_UNAVAILABLE')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  if (logo) drawImageContain(context, logo, EXPORT_MARGIN, 34, 82, 82, 5)
  else drawFallbackLogo(context, EXPORT_MARGIN, 34, 82)
  drawText(context, '私家E院', EXPORT_MARGIN + 104, 68, 27, '#0f5f8f', 900)
  drawText(context, 'EasonFansClub', EXPORT_MARGIN + 104, 101, 17, '#7b8b98', 700)
  context.textAlign = 'right'
  drawText(context, '贝多芬与我', EXPORT_WIDTH - EXPORT_MARGIN, 63, 30, '#102033', 900)
  context.textAlign = 'left'
  drawText(context, '贝多芬与我 · 拼豆图纸', EXPORT_MARGIN, 177, 32, '#102033', 900)
  drawText(context, `作品：${title}`, EXPORT_MARGIN, 220, 20, '#52606d', 700)
  drawText(context, `尺寸：${pattern.width} × ${pattern.height} 颗`, EXPORT_MARGIN, 253, 18, '#52606d', 600)
  drawText(context, `拼豆板：${materials.boardCount} 块`, EXPORT_MARGIN + 355, 253, 18, '#52606d', 600)
  drawText(context, `豆子数量：${materials.totalBeads.toLocaleString()} 颗`, EXPORT_MARGIN, 279, 18, '#52606d', 600)
  drawText(context, `颜色数量：${materials.colorCount} 种`, EXPORT_MARGIN + 355, 279, 18, '#52606d', 600)
  drawText(context, `色板：${paletteLabel(pattern)}`, EXPORT_MARGIN + 640, 253, 18, '#52606d', 600)
  context.drawImage(qrCanvas, EXPORT_WIDTH - EXPORT_MARGIN - EXPORT_QR_SIZE, 78, EXPORT_QR_SIZE, EXPORT_QR_SIZE)

  grid(context, pattern, EXPORT_MARGIN, EXPORT_HEADER_HEIGHT)
  drawText(context, '材料统计', EXPORT_MARGIN, materialTop - 34, 25, '#102033', 900)
  const columnWidth = (EXPORT_WIDTH - EXPORT_MARGIN * 2) / columnCount
  materials.materials.forEach((material, index) => {
    const column = index % columnCount
    const row = Math.floor(index / columnCount)
    const left = EXPORT_MARGIN + column * columnWidth
    const top = materialTop + row * MATERIAL_ROW_HEIGHT
    context.fillStyle = material.hex
    context.fillRect(left, top, 30, 30)
    context.strokeStyle = 'rgba(0,0,0,.16)'
    context.lineWidth = 1
    context.strokeRect(left + .5, top + .5, 29, 29)
    drawText(context, `${material.code} · ${material.name}`, left + 44, top + 16, 15, '#102033', 800)
    drawText(context, `数量：${material.quantity} 颗 · 包装：${material.packs} 包`, left + 44, top + 39, 13, '#7b8b98', 600)
  })
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('BEAD_EXPORT_IMAGE_CREATE_FAILED')), type, quality)
  })
}

function ascii(value: string) {
  return new TextEncoder().encode(value)
}

function concatBytes(chunks: readonly Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0))
  let offset = 0
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.byteLength })
  return output
}

function buildJpegPdf(jpeg: Uint8Array, imageWidth: number, imageHeight: number) {
  const pageWidth = 595
  const pageHeight = Math.max(842, Math.min(2400, pageWidth * imageHeight / Math.max(1, imageWidth)))
  const scale = Math.min(pageWidth / Math.max(1, imageWidth), pageHeight / Math.max(1, imageHeight))
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  const content = ascii(`q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${((pageWidth - drawWidth) / 2).toFixed(2)} ${((pageHeight - drawHeight) / 2).toFixed(2)} cm /Im0 Do Q`)
  const objects = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    concatBytes([ascii(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`), jpeg, ascii('\nendstream')]),
    concatBytes([ascii(`<< /Length ${content.byteLength} >>\nstream\n`), content, ascii('\nendstream')]),
  ]
  const header = ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const chunks: Uint8Array[] = [header]
  const offsets = [0]
  let offset = header.byteLength
  objects.forEach((object, index) => {
    const chunk = concatBytes([ascii(`${index + 1} 0 obj\n`), object, ascii('\nendobj\n')])
    offsets.push(offset)
    chunks.push(chunk)
    offset += chunk.byteLength
  })
  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((value) => { xref += `${String(value).padStart(10, '0')} 00000 n \n` })
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  chunks.push(ascii(xref))
  return concatBytes(chunks)
}

export async function createBrandedBeadPatternJpg(input: BrandedBeadExportInput) {
  const canvas = await renderBrandedBeadPattern(input)
  return canvasToBlob(canvas, 'image/jpeg', .95)
}

export async function createBrandedBeadPatternPdf(input: BrandedBeadExportInput) {
  const canvas = await renderBrandedBeadPattern(input)
  const jpg = await canvasToBlob(canvas, 'image/jpeg', .95)
  const pdfBytes = buildJpegPdf(new Uint8Array(await jpg.arrayBuffer()), canvas.width, canvas.height)
  return new Blob([pdfBytes], { type: 'application/pdf' })
}
