export type ImageEditorPoint = {
  x: number
  y: number
}

export type ImageEditorRect = {
  x: number
  y: number
  width: number
  height: number
}

export type ImageEditorRotation = 0 | 90 | 180 | 270
export type ImageEditorTool = 'select' | 'crop' | 'draw' | 'shape' | 'arrow' | 'text' | 'mosaic'
export type ImageEditorShape = 'rect' | 'ellipse'

type BaseAnnotation = {
  id: string
  color: string
  width: number
}

export type ImageEditorStroke = BaseAnnotation & {
  type: 'stroke'
  points: ImageEditorPoint[]
}

export type ImageEditorMosaic = BaseAnnotation & {
  type: 'mosaic'
  points: ImageEditorPoint[]
  /** Pixel block size in canonical image-space pixels. */
  pixelSize?: number
}

export type ImageEditorShapeAnnotation = BaseAnnotation & {
  type: 'shape'
  shape: ImageEditorShape
  start: ImageEditorPoint
  end: ImageEditorPoint
}

export type ImageEditorArrow = BaseAnnotation & {
  type: 'arrow'
  start: ImageEditorPoint
  end: ImageEditorPoint
}

export type ImageEditorText = {
  id: string
  type: 'text'
  position: ImageEditorPoint
  text: string
  color: string
  fontSize: number
}

export type ImageEditorAnnotation = ImageEditorStroke | ImageEditorMosaic | ImageEditorShapeAnnotation | ImageEditorArrow | ImageEditorText

export type ImageEditorState = {
  rotation: ImageEditorRotation
  crop: ImageEditorRect | null
  annotations: ImageEditorAnnotation[]
}

export function createImageEditorId(prefix = 'image-editor') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createInitialImageEditorState(): ImageEditorState {
  return {
    rotation: 0,
    crop: null,
    annotations: [],
  }
}

export function cloneImageEditorPoint(point: ImageEditorPoint): ImageEditorPoint {
  return { x: point.x, y: point.y }
}

export function cloneImageEditorState(state: ImageEditorState): ImageEditorState {
  return {
    rotation: state.rotation,
    crop: state.crop ? { ...state.crop } : null,
    annotations: state.annotations.map((annotation) => {
      if (annotation.type === 'stroke' || annotation.type === 'mosaic') {
        return {
          ...annotation,
          points: annotation.points.map(cloneImageEditorPoint),
        }
      }
      if (annotation.type === 'text') {
        return {
          ...annotation,
          position: cloneImageEditorPoint(annotation.position),
        }
      }
      return {
        ...annotation,
        start: cloneImageEditorPoint(annotation.start),
        end: cloneImageEditorPoint(annotation.end),
      }
    }),
  }
}

export function normalizeImageEditorRect(start: ImageEditorPoint, end: ImageEditorPoint): ImageEditorRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function imageEditorDimensions(width: number, height: number, rotation: ImageEditorRotation) {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height }
}

export function rotateImageEditorPoint(point: ImageEditorPoint, width: number, height: number): ImageEditorPoint {
  return { x: height - point.y, y: point.x }
}

function rotateRect(rect: ImageEditorRect, width: number, height: number): ImageEditorRect {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => rotateImageEditorPoint(point, width, height))
  const left = Math.min(...corners.map((point) => point.x))
  const top = Math.min(...corners.map((point) => point.y))
  const right = Math.max(...corners.map((point) => point.x))
  const bottom = Math.max(...corners.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function rotateAnnotation(annotation: ImageEditorAnnotation, width: number, height: number): ImageEditorAnnotation {
  if (annotation.type === 'stroke' || annotation.type === 'mosaic') {
    return { ...annotation, points: annotation.points.map((point) => rotateImageEditorPoint(point, width, height)) }
  }
  if (annotation.type === 'text') {
    return { ...annotation, position: rotateImageEditorPoint(annotation.position, width, height) }
  }
  return {
    ...annotation,
    start: rotateImageEditorPoint(annotation.start, width, height),
    end: rotateImageEditorPoint(annotation.end, width, height),
  }
}

/**
 * Rotate the current editor viewport clockwise while keeping existing marks
 * attached to the same pixels. Coordinates are always expressed in the
 * current, EXIF-corrected image space.
 */
export function rotateImageEditorState(state: ImageEditorState, sourceWidth: number, sourceHeight: number): ImageEditorState {
  const currentDimensions = imageEditorDimensions(sourceWidth, sourceHeight, state.rotation)
  const nextRotation = ((state.rotation + 90) % 360) as ImageEditorRotation
  return {
    rotation: nextRotation,
    crop: state.crop ? rotateRect(state.crop, currentDimensions.width, currentDimensions.height) : null,
    annotations: state.annotations.map((annotation) => rotateAnnotation(annotation, currentDimensions.width, currentDimensions.height)),
  }
}

export function imageEditorViewRect(sourceWidth: number, sourceHeight: number, state: ImageEditorState): ImageEditorRect {
  const dimensions = imageEditorDimensions(sourceWidth, sourceHeight, state.rotation)
  return state.crop ? { ...state.crop } : { x: 0, y: 0, width: dimensions.width, height: dimensions.height }
}

export function imageEditorStateHasEdits(state: ImageEditorState): boolean {
  return state.rotation !== 0 || Boolean(state.crop) || state.annotations.length > 0
}
