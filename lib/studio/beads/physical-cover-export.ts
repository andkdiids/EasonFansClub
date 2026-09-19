import { renderPatternToCanvas } from './renderer'
import type { BeadPatternGrid } from './types'

type PhysicalCoverExportOptions = Readonly<{
  beadMode?: boolean
  displayGrid?: boolean
  displayCodes?: boolean
  renderScale?: number
}>

function loadCoverImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('PHYSICAL_COVER_IMAGE_UNAVAILABLE'))
    image.src = source
  })
}

function drawContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const imageWidth = Math.max(1, image.naturalWidth || image.width)
  const imageHeight = Math.max(1, image.naturalHeight || image.height)
  const scale = Math.min(width / imageWidth, height / imageHeight)
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PHYSICAL_COVER_EXPORT_FAILED')), 'image/png')
  })
}

/**
 * Creates the optional single-image export containing the physical cover and
 * the regular grid. The editor ruler is intentionally not part of this image.
 */
export async function createPatternWithPhysicalCoverPng(pattern: BeadPatternGrid, coverUrl: string, options: PhysicalCoverExportOptions = {}) {
  const cover = await loadCoverImage(coverUrl)
  const patternCanvas = document.createElement('canvas')
  renderPatternToCanvas(patternCanvas, pattern, {
    beadMode: options.beadMode,
    displayGrid: options.displayGrid,
    displayCodes: options.displayCodes,
    transparentBackground: false,
    renderScale: options.renderScale,
  })

  const margin = 64
  const gap = 44
  const maxCoverWidth = 2400
  const maxCoverHeight = 1500
  const maxPatternWidth = 5000
  const coverWidth = Math.min(maxCoverWidth, Math.max(1, cover.naturalWidth || cover.width))
  const coverHeight = Math.min(maxCoverHeight, Math.max(1, cover.naturalHeight || cover.height))
  const coverScale = Math.min(1, maxCoverWidth / coverWidth, maxCoverHeight / coverHeight)
  const renderedCoverWidth = Math.max(1, Math.round(coverWidth * coverScale))
  const renderedCoverHeight = Math.max(1, Math.round(coverHeight * coverScale))
  const patternScale = Math.min(1, maxPatternWidth / Math.max(1, patternCanvas.width))
  const renderedPatternWidth = Math.max(1, Math.round(patternCanvas.width * patternScale))
  const renderedPatternHeight = Math.max(1, Math.round(patternCanvas.height * patternScale))
  const width = Math.max(renderedCoverWidth, renderedPatternWidth) + margin * 2
  const height = renderedCoverHeight + renderedPatternHeight + margin * 2 + gap

  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const context = output.getContext('2d')
  if (!context) throw new Error('PHYSICAL_COVER_EXPORT_FAILED')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  drawContain(context, cover, margin, margin, width - margin * 2, renderedCoverHeight)
  context.drawImage(patternCanvas, margin + (width - margin * 2 - renderedPatternWidth) / 2, margin + renderedCoverHeight + gap, renderedPatternWidth, renderedPatternHeight)
  return canvasBlob(output)
}
