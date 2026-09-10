import {
  imageEditorDimensions,
  imageEditorViewRect,
  normalizeImageEditorRect,
  type ImageEditorAnnotation,
  type ImageEditorPoint,
  type ImageEditorRect,
  type ImageEditorState,
} from '@/lib/image-editor'

export const IMAGE_EDITOR_PREVIEW_MAX_EDGE = 2048
export const IMAGE_EDITOR_EXPORT_MAX_EDGE = 4096

export type DecodedImageEditorImage = {
  source: CanvasImageSource
  width: number
  height: number
  rawWidth: number
  rawHeight: number
  orientation: number
  cleanup: () => void
}

export type RenderedImageEditorCanvas = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  scale: number
  viewRect: ImageEditorRect
}

function numberInRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clampRect(rect: ImageEditorRect, width: number, height: number): ImageEditorRect {
  const x = numberInRange(rect.x, 0, Math.max(0, width - 1))
  const y = numberInRange(rect.y, 0, Math.max(0, height - 1))
  return {
    x,
    y,
    width: numberInRange(rect.width, 1, Math.max(1, width - x)),
    height: numberInRange(rect.height, 1, Math.max(1, height - y)),
  }
}

async function readJpegOrientation(file: File) {
  if (!/^image\/(jpe?g|pjpeg)$/i.test(file.type) && !/\.(jpe?g)$/i.test(file.name)) return 1
  try {
    const buffer = await file.slice(0, 256 * 1024).arrayBuffer()
    const view = new DataView(buffer)
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1
    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1)
      offset += 2
      if (marker === 0xd9 || marker === 0xda) break
      const segmentLength = view.getUint16(offset, false)
      if (segmentLength < 2 || offset + segmentLength > view.byteLength) break
      if (marker === 0xe1 && segmentLength >= 10 && view.getUint32(offset + 2, false) === 0x45786966 && view.getUint16(offset + 6, false) === 0) {
        const tiff = offset + 8
        const littleEndian = view.getUint16(tiff, false) === 0x4949
        const read16 = (position: number) => view.getUint16(position, littleEndian)
        const read32 = (position: number) => view.getUint32(position, littleEndian)
        if (read16(tiff + 2) !== 0x2a) return 1
        const directory = tiff + read32(tiff + 4)
        const entries = read16(directory)
        for (let index = 0; index < entries; index += 1) {
          const entry = directory + 2 + index * 12
          if (entry + 12 > view.byteLength) break
          if (read16(entry) !== 0x0112) continue
          const type = read16(entry + 2)
          const count = read32(entry + 4)
          if (type === 3 && count >= 1) return numberInRange(read16(entry + 8), 1, 8)
        }
      }
      offset += segmentLength
    }
  } catch {
    // A malformed or unsupported EXIF block should not prevent editing.
  }
  return 1
}

function waitForImage(image: HTMLImageElement) {
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('图片无法解码'))
  })
}

export async function decodeImageForEditor(file: File): Promise<DecodedImageEditorImage> {
  const objectUrl = URL.createObjectURL(file)
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        rawWidth: bitmap.width,
        rawHeight: bitmap.height,
        orientation: 1,
        cleanup: () => {
          bitmap.close()
          URL.revokeObjectURL(objectUrl)
        },
      }
    } catch {
      // Safari and some WebViews do not implement createImageBitmap for all
      // formats. The HTMLImageElement fallback below keeps those uploads usable.
    }
  }

  const image = new Image()
  image.decoding = 'async'
  image.src = objectUrl
  try {
    await image.decode().catch(() => waitForImage(image))
  } catch (reason) {
    URL.revokeObjectURL(objectUrl)
    throw reason instanceof Error ? reason : new Error('图片无法解码')
  }
  const rawWidth = image.naturalWidth || image.width
  const rawHeight = image.naturalHeight || image.height
  const orientation = await readJpegOrientation(file)
  const width = orientation >= 5 && orientation <= 8 ? rawHeight : rawWidth
  const height = orientation >= 5 && orientation <= 8 ? rawWidth : rawHeight
  return {
    source: image,
    width,
    height,
    rawWidth,
    rawHeight,
    orientation,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  }
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function drawExifOrientedSource(decoded: DecodedImageEditorImage, scale: number) {
  const canvas = createCanvas(decoded.width * scale, decoded.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持图片画布')
  const width = decoded.rawWidth * scale
  const height = decoded.rawHeight * scale
  context.save()
  switch (decoded.orientation) {
    case 2:
      context.translate(width, 0)
      context.scale(-1, 1)
      break
    case 3:
      context.translate(width, height)
      context.rotate(Math.PI)
      break
    case 4:
      context.translate(0, height)
      context.scale(1, -1)
      break
    case 5:
      context.rotate(Math.PI / 2)
      context.scale(1, -1)
      break
    case 6:
      context.rotate(Math.PI / 2)
      context.translate(0, -height)
      break
    case 7:
      context.rotate(Math.PI / 2)
      context.translate(width, -height)
      context.scale(-1, 1)
      break
    case 8:
      context.rotate(-Math.PI / 2)
      context.translate(-width, 0)
      break
    default:
      break
  }
  context.drawImage(decoded.source, 0, 0, width, height)
  context.restore()
  return canvas
}

function rotateCanvas(source: HTMLCanvasElement, rotation: ImageEditorState['rotation']) {
  const width = source.width
  const height = source.height
  const dimensions = imageEditorDimensions(width, height, rotation)
  const canvas = createCanvas(dimensions.width, dimensions.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持图片画布')
  context.save()
  if (rotation === 90) {
    context.translate(height, 0)
    context.rotate(Math.PI / 2)
  } else if (rotation === 180) {
    context.translate(width, height)
    context.rotate(Math.PI)
  } else if (rotation === 270) {
    context.translate(0, width)
    context.rotate(-Math.PI / 2)
  }
  context.drawImage(source, 0, 0)
  context.restore()
  return canvas
}

function drawPath(context: CanvasRenderingContext2D, points: readonly ImageEditorPoint[], scale: number, offset: ImageEditorPoint) {
  if (!points.length) return
  context.beginPath()
  context.moveTo((points[0].x - offset.x) * scale, (points[0].y - offset.y) * scale)
  for (const point of points.slice(1)) context.lineTo((point.x - offset.x) * scale, (point.y - offset.y) * scale)
  if (points.length === 1) context.lineTo((points[0].x - offset.x + 0.01) * scale, (points[0].y - offset.y + 0.01) * scale)
  context.stroke()
}

function drawArrow(context: CanvasRenderingContext2D, annotation: Extract<ImageEditorAnnotation, { type: 'arrow' }>, scale: number, offset: ImageEditorPoint) {
  const start = { x: (annotation.start.x - offset.x) * scale, y: (annotation.start.y - offset.y) * scale }
  const end = { x: (annotation.end.x - offset.x) * scale, y: (annotation.end.y - offset.y) * scale }
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const headLength = Math.max(8 * scale, annotation.width * scale * 3)
  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x, end.y)
  context.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6))
  context.moveTo(end.x, end.y)
  context.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6))
  context.stroke()
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: ImageEditorAnnotation, scale: number, offset: ImageEditorPoint) {
  context.save()
  context.strokeStyle = 'color' in annotation ? annotation.color : '#ef4444'
  context.fillStyle = 'color' in annotation ? annotation.color : '#ef4444'
  context.lineWidth = ('width' in annotation ? annotation.width : 4) * scale
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (annotation.type === 'stroke') {
    drawPath(context, annotation.points, scale, offset)
  } else if (annotation.type === 'shape') {
    const rect = normalizeImageEditorRect(annotation.start, annotation.end)
    const x = (rect.x - offset.x) * scale
    const y = (rect.y - offset.y) * scale
    const width = rect.width * scale
    const height = rect.height * scale
    if (annotation.shape === 'ellipse') {
      context.beginPath()
      context.ellipse(x + width / 2, y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2)
      context.stroke()
    } else {
      context.strokeRect(x, y, width, height)
    }
  } else if (annotation.type === 'arrow') {
    drawArrow(context, annotation, scale, offset)
  } else if (annotation.type === 'text') {
    context.font = `700 ${Math.max(10, annotation.fontSize * scale)}px Arial, sans-serif`
    context.textBaseline = 'top'
    context.fillText(annotation.text, (annotation.position.x - offset.x) * scale, (annotation.position.y - offset.y) * scale)
  }
  context.restore()
}

function makePixelatedCanvas(source: HTMLCanvasElement) {
  const low = createCanvas(Math.max(1, Math.ceil(source.width / 12)), Math.max(1, Math.ceil(source.height / 12)))
  const lowContext = low.getContext('2d')
  if (!lowContext) throw new Error('当前浏览器不支持图片画布')
  lowContext.imageSmoothingEnabled = false
  lowContext.drawImage(source, 0, 0, low.width, low.height)
  const pixelated = createCanvas(source.width, source.height)
  const pixelatedContext = pixelated.getContext('2d')
  if (!pixelatedContext) throw new Error('当前浏览器不支持图片画布')
  pixelatedContext.imageSmoothingEnabled = false
  pixelatedContext.drawImage(low, 0, 0, pixelated.width, pixelated.height)
  return pixelated
}

function drawMosaic(context: CanvasRenderingContext2D, source: HTMLCanvasElement, annotation: Extract<ImageEditorAnnotation, { type: 'mosaic' }>, scale: number, offset: ImageEditorPoint) {
  if (!annotation.points.length) return
  const pixelated = makePixelatedCanvas(source)
  const layer = createCanvas(context.canvas.width, context.canvas.height)
  const layerContext = layer.getContext('2d')
  const mask = createCanvas(context.canvas.width, context.canvas.height)
  const maskContext = mask.getContext('2d')
  if (!layerContext || !maskContext) throw new Error('当前浏览器不支持图片画布')
  layerContext.imageSmoothingEnabled = false
  layerContext.drawImage(pixelated, -offset.x * scale, -offset.y * scale, source.width, source.height)
  maskContext.strokeStyle = '#fff'
  maskContext.beginPath()
  maskContext.moveTo((annotation.points[0].x - offset.x) * scale, (annotation.points[0].y - offset.y) * scale)
  for (const point of annotation.points.slice(1)) maskContext.lineTo((point.x - offset.x) * scale, (point.y - offset.y) * scale)
  maskContext.lineWidth = Math.max(annotation.width * scale * 2.5, 12 * scale)
  maskContext.lineCap = 'round'
  maskContext.lineJoin = 'round'
  maskContext.stroke()
  layerContext.globalCompositeOperation = 'destination-in'
  layerContext.drawImage(mask, 0, 0)
  context.drawImage(layer, 0, 0)
}

function annotationBounds(annotation: ImageEditorAnnotation) {
  if (annotation.type === 'stroke' || annotation.type === 'mosaic') {
    if (!annotation.points.length) return null
    const xs = annotation.points.map((point) => point.x)
    const ys = annotation.points.map((point) => point.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  if (annotation.type === 'text') {
    return { x: annotation.position.x, y: annotation.position.y, width: annotation.text.length * annotation.fontSize * 0.6, height: annotation.fontSize * 1.25 }
  }
  return normalizeImageEditorRect(annotation.start, annotation.end)
}

function drawSelection(context: CanvasRenderingContext2D, annotation: ImageEditorAnnotation, scale: number, offset: ImageEditorPoint) {
  const bounds = annotationBounds(annotation)
  if (!bounds) return
  context.save()
  context.strokeStyle = '#38bdf8'
  context.fillStyle = '#38bdf8'
  context.lineWidth = Math.max(1, scale * 1.5)
  context.setLineDash([5 * scale, 4 * scale])
  context.strokeRect((bounds.x - offset.x) * scale, (bounds.y - offset.y) * scale, Math.max(1, bounds.width * scale), Math.max(1, bounds.height * scale))
  context.setLineDash([])
  if (annotation.type === 'shape') {
    context.fillRect((annotation.end.x - offset.x) * scale - 4, (annotation.end.y - offset.y) * scale - 4, 8, 8)
  } else if (annotation.type === 'arrow') {
    context.fillRect((annotation.start.x - offset.x) * scale - 4, (annotation.start.y - offset.y) * scale - 4, 8, 8)
    context.fillRect((annotation.end.x - offset.x) * scale - 4, (annotation.end.y - offset.y) * scale - 4, 8, 8)
  }
  context.restore()
}

export function renderImageEditorState(
  decoded: DecodedImageEditorImage,
  state: ImageEditorState,
  maxEdge: number,
  selectedId: string | null = null,
): RenderedImageEditorCanvas {
  const view = imageEditorViewRect(decoded.width, decoded.height, state)
  const dimensions = imageEditorDimensions(decoded.width, decoded.height, state.rotation)
  const safeView = clampRect(view, dimensions.width, dimensions.height)
  const scale = Math.min(1, maxEdge / Math.max(1, safeView.width, safeView.height))
  const oriented = drawExifOrientedSource(decoded, scale)
  const rotated = rotateCanvas(oriented, state.rotation)
  const canvas = createCanvas(safeView.width * scale, safeView.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持图片画布')
  context.imageSmoothingEnabled = true
  context.drawImage(rotated, -safeView.x * scale, -safeView.y * scale)

  const offset = { x: safeView.x, y: safeView.y }
  for (const annotation of state.annotations) {
    if (annotation.type === 'mosaic') drawMosaic(context, rotated, annotation, scale, offset)
  }
  for (const annotation of state.annotations) {
    if (annotation.type !== 'mosaic') drawAnnotation(context, annotation, scale, offset)
  }
  if (selectedId) {
    const selected = state.annotations.find((annotation) => annotation.id === selectedId)
    if (selected) drawSelection(context, selected, scale, offset)
  }
  return { canvas, width: canvas.width, height: canvas.height, scale, viewRect: safeView }
}

export function editorPointFromClient(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  viewRect: ImageEditorRect,
): ImageEditorPoint {
  const rect = canvas.getBoundingClientRect()
  const x = rect.width ? (clientX - rect.left) / rect.width : 0
  const y = rect.height ? (clientY - rect.top) / rect.height : 0
  return {
    x: numberInRange(viewRect.x + x * viewRect.width, viewRect.x, viewRect.x + viewRect.width),
    y: numberInRange(viewRect.y + y * viewRect.height, viewRect.y, viewRect.y + viewRect.height),
  }
}

export async function exportImageEditorFile(decoded: DecodedImageEditorImage, state: ImageEditorState, originalName: string) {
  const rendered = renderImageEditorState(decoded, state, IMAGE_EDITOR_EXPORT_MAX_EDGE)
  const blob = await new Promise<Blob>((resolve, reject) => {
    rendered.canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('图片导出失败'))
    }, 'image/png')
  })
  const baseName = originalName.replace(/\.[^.]+$/, '') || 'edited-image'
  return new File([blob], `${baseName}.png`, { type: 'image/png', lastModified: Date.now() })
}
