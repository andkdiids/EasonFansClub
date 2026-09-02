import { applyFloydSteinberg, deltaE76, findNearestBeadColor, quantizeColors, rgbToLab, type ColorMatchMode } from './color'
import { removeTinyColorRegions } from './grid'
import type { BeadPaletteColor, BeadPatternGrid, BeadRgb, BeadSettings } from './types'
import { EMPTY_CELL, MAX_BEAD_DIMENSION } from './types'

function cropAspectRatio(value: BeadSettings['cropRatio']) {
  if (value === '1:1') return 1
  if (value === '4:3') return 4 / 3
  if (value === '3:4') return 3 / 4
  if (value === '16:9') return 16 / 9
  if (value === '9:16') return 9 / 16
  return null
}

function adjustedRgb(rgb: BeadRgb, settings: BeadSettings): BeadRgb {
  const brightness = settings.brightness / 100
  const contrast = (settings.contrast + 100) / 100
  const saturation = (settings.saturation + 100) / 100
  const contrasted = (value: number) => Math.max(0, Math.min(255, (value - 128) * contrast + 128 + brightness * 128))
  const r = contrasted(rgb.r)
  const g = contrasted(rgb.g)
  const b = contrasted(rgb.b)
  const average = (r + g + b) / 3
  return {
    r: Math.max(0, Math.min(255, average + (r - average) * saturation)),
    g: Math.max(0, Math.min(255, average + (g - average) * saturation)),
    b: Math.max(0, Math.min(255, average + (b - average) * saturation)),
  }
}

function distanceRgb(left: BeadRgb, right: BeadRgb) {
  return Math.sqrt((left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2)
}

function nearestQuantizedColor(rgb: BeadRgb, colors: readonly BeadRgb[]) {
  let nearest = 0
  let distance = Number.POSITIVE_INFINITY
  const lab = rgbToLab(rgb)
  colors.forEach((color, index) => {
    const nextDistance = deltaE76(lab, rgbToLab(color))
    if (nextDistance < distance) {
      distance = nextDistance
      nearest = index
    }
  })
  return nearest
}

function drawImageToTarget(source: CanvasImageSource, width: number, height: number, settings: BeadSettings) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建图片处理画布')
  const sourceWithDimensions = source as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }
  const sourceWidth = typeof sourceWithDimensions.naturalWidth === 'number' ? sourceWithDimensions.naturalWidth : Number(sourceWithDimensions.width)
  const sourceHeight = typeof sourceWithDimensions.naturalHeight === 'number' ? sourceWithDimensions.naturalHeight : Number(sourceWithDimensions.height)
  const targetAspect = cropAspectRatio(settings.cropRatio) || width / height
  const sourceAspect = sourceWidth / Math.max(1, sourceHeight)
  let cropWidth = sourceWidth
  let cropHeight = sourceHeight
  if (sourceAspect > targetAspect) cropWidth = sourceHeight * targetAspect
  else cropHeight = sourceWidth / targetAspect
  const maxX = Math.max(0, sourceWidth - cropWidth)
  const maxY = Math.max(0, sourceHeight - cropHeight)
  const sourceX = maxX / 2 + maxX * (settings.cropX / 100)
  const sourceY = maxY / 2 + maxY * (settings.cropY / 100)
  const zoom = Math.max(1, settings.cropZoom)
  context.clearRect(0, 0, width, height)
  context.save()
  context.translate(width / 2, height / 2)
  context.rotate(settings.rotation * Math.PI / 180)
  context.scale(zoom, zoom)
  context.drawImage(source, sourceX, sourceY, cropWidth, cropHeight, -width / 2, -height / 2, width, height)
  context.restore()
  return context.getImageData(0, 0, width, height)
}

function samplesFromImageData(imageData: ImageData, settings: BeadSettings) {
  const samples: BeadRgb[] = []
  const transparent: boolean[] = []
  for (let index = 0; index < imageData.width * imageData.height; index += 1) {
    const offset = index * 4
    samples.push(adjustedRgb({ r: imageData.data[offset], g: imageData.data[offset + 1], b: imageData.data[offset + 2] }, settings))
    transparent.push(imageData.data[offset + 3] < 32)
  }
  return { samples, transparent }
}

/** Pure pixel-to-grid processing. It can run on the main thread or in a worker. */
export function generatePatternFromPixels(samples: readonly BeadRgb[], transparent: readonly boolean[], settings: BeadSettings, palette: readonly BeadPaletteColor[]): BeadPatternGrid {
  const width = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(settings.width)))
  const height = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(settings.height)))
  if (samples.length !== width * height || transparent.length !== samples.length) throw new Error('图片采样尺寸不正确')
  const activePalette = palette.filter((color) => color.enabled !== false)
  if (!activePalette.length) throw new Error('当前色板没有可用颜色')
  let backgroundColor: BeadRgb | null = null
  for (let index = 0; index < width * height; index += 1) {
    if (!backgroundColor && !transparent[index]) backgroundColor = samples[index]
  }
  const quantized = settings.maxColors > 0 ? quantizeColors(samples, settings.maxColors) : samples
  const mode: ColorMatchMode = settings.matchingMode
  const ditheringPalette = settings.maxColors > 0
    ? [...new Set(quantized.map((color) => findNearestBeadColor(color, activePalette, mode)))].filter((index) => index >= 0).map((index) => activePalette[index])
    : activePalette
  const ditheredIndexes = settings.dithering === 'floyd-steinberg'
    ? applyFloydSteinberg(samples, width, height, ditheringPalette, mode).map((index) => {
      const color = ditheringPalette[index]
      return palette.indexOf(color)
    })
    : null
  const cells = samples.map((rgb, index) => {
    if (transparent[index]) return EMPTY_CELL
    if (settings.whiteAsEmpty && rgb.r > 244 && rgb.g > 244 && rgb.b > 244) return EMPTY_CELL
    if (settings.removeBackground && backgroundColor && distanceRgb(rgb, backgroundColor) <= settings.backgroundTolerance) return EMPTY_CELL
    if (ditheredIndexes) return ditheredIndexes[index]
    const sourceColor = settings.maxColors > 0 ? quantized[nearestQuantizedColor(rgb, quantized)] : rgb
    return palette.indexOf(activePalette[findNearestBeadColor(sourceColor, activePalette, mode)])
  })
  return {
    width,
    height,
    palette: [...palette],
    cells: removeTinyColorRegions(cells, width, height, settings.cleanupThreshold),
  }
}

export function generatePatternFromImage(source: CanvasImageSource, settings: BeadSettings, palette: readonly BeadPaletteColor[]): BeadPatternGrid {
  const width = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(settings.width)))
  const height = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(settings.height)))
  const { samples, transparent } = samplesFromImageData(drawImageToTarget(source, width, height, settings), settings)
  return generatePatternFromPixels(samples, transparent, settings, palette)
}

/** Run color-heavy processing off the UI thread when module workers are available. */
export function generatePatternFromImageInWorker(source: CanvasImageSource, settings: BeadSettings, palette: readonly BeadPaletteColor[]): Promise<BeadPatternGrid> {
  const width = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(settings.width)))
  const height = Math.max(1, Math.min(MAX_BEAD_DIMENSION, Math.round(settings.height)))
  const { samples, transparent } = samplesFromImageData(drawImageToTarget(source, width, height, settings), settings)
  const fallback = () => generatePatternFromPixels(samples, transparent, settings, palette)
  if (typeof Worker === 'undefined') return Promise.resolve(fallback())
  return new Promise<BeadPatternGrid>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./beads.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      try { resolve(fallback()) } catch (error) { reject(error) }
      return
    }
    worker.onmessage = (event: MessageEvent<{ ok?: boolean; pattern?: BeadPatternGrid; message?: string }>) => {
      worker.terminate()
      if (event.data.ok && event.data.pattern) resolve(event.data.pattern)
      else {
        try { resolve(fallback()) } catch (error) { reject(error) }
      }
    }
    worker.onerror = () => {
      worker.terminate()
      try { resolve(fallback()) } catch (error) { reject(error) }
    }
    try {
      worker.postMessage({ samples, transparent, settings, palette })
    } catch {
      worker.terminate()
      try { resolve(fallback()) } catch (error) { reject(error) }
    }
  })
}

export function imageDataToLab(imageData: ImageData) {
  const result = new Array(imageData.width * imageData.height)
  for (let index = 0; index < result.length; index += 1) {
    const offset = index * 4
    result[index] = rgbToLab({ r: imageData.data[offset], g: imageData.data[offset + 1], b: imageData.data[offset + 2] })
  }
  return result
}
