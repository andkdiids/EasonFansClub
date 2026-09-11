'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  cloneImageEditorState,
  createImageEditorId,
  createInitialImageEditorState,
  imageEditorDimensions,
  imageEditorViewRect,
  normalizeImageEditorRect,
  rotateImageEditorState,
  type ImageEditorAnnotation,
  type ImageEditorPoint,
  type ImageEditorRect,
  type ImageEditorShape,
  type ImageEditorState,
  type ImageEditorTool,
} from '@/lib/image-editor'
import {
  clientPointToImagePoint,
  decodeImageForEditor,
  exportImageEditorFile,
  IMAGE_EDITOR_PREVIEW_MAX_EDGE,
  renderImageEditorState,
  type DecodedImageEditorImage,
  type RenderedImageEditorCanvas,
} from '@/lib/image-editor-browser'
import { UiIcon } from '@/components/UiIcon'

type ImageEditorProps = Readonly<{
  file: File
  onCancel: () => void
  onComplete: (file: File) => void
}>

type CropRatio = 'free' | '1:1' | '4:3' | '3:4' | '16:9'
type CropHandle = 'nw' | 'ne' | 'sw' | 'se'

type Interaction = {
  baseIndex: number
  baseState: ImageEditorState
  mode: 'draw' | 'crop-new' | 'crop-move' | 'crop-resize' | 'move' | 'resize'
  id?: string
  handle?: 'start' | 'end' | CropHandle
  start: ImageEditorPoint
  changed: boolean
}

type FloatingSelectionPosition = Readonly<{
  deleteLeft: number
  deleteTop: number
  copyLeft: number
  copyTop: number
}>

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#38bdf8', '#ffffff']

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function pointDistance(a: ImageEditorPoint, b: ImageEditorPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distanceToSegment(point: ImageEditorPoint, start: ImageEditorPoint, end: ImageEditorPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return pointDistance(point, start)
  const progress = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1)
  return pointDistance(point, { x: start.x + progress * dx, y: start.y + progress * dy })
}

function annotationBounds(annotation: ImageEditorAnnotation) {
  if (annotation.type === 'stroke' || annotation.type === 'mosaic') {
    if (!annotation.points.length) return null
    const xs = annotation.points.map((point) => point.x)
    const ys = annotation.points.map((point) => point.y)
    const padding = Math.max(2, annotation.width / 2)
    return {
      x: Math.min(...xs) - padding,
      y: Math.min(...ys) - padding,
      width: Math.max(1, Math.max(...xs) - Math.min(...xs) + padding * 2),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys) + padding * 2),
    }
  }
  if (annotation.type === 'text') {
    return { x: annotation.position.x, y: annotation.position.y, width: Math.max(annotation.fontSize, annotation.text.length * annotation.fontSize * 0.6), height: annotation.fontSize * 1.3 }
  }
  const rect = normalizeImageEditorRect(annotation.start, annotation.end)
  const padding = Math.max(2, annotation.width / 2)
  return { x: rect.x - padding, y: rect.y - padding, width: Math.max(1, rect.width + padding * 2), height: Math.max(1, rect.height + padding * 2) }
}

function hitTestAnnotation(state: ImageEditorState, point: ImageEditorPoint) {
  const tolerance = 22
  for (const annotation of [...state.annotations].reverse()) {
    if (annotation.type === 'stroke' || annotation.type === 'mosaic') {
      for (let index = 1; index < annotation.points.length; index += 1) {
        if (distanceToSegment(point, annotation.points[index - 1], annotation.points[index]) <= tolerance + annotation.width * 1.5) return annotation
      }
      if (annotation.points.some((candidate) => pointDistance(point, candidate) <= tolerance + annotation.width)) return annotation
    } else if (annotation.type === 'arrow') {
      if (distanceToSegment(point, annotation.start, annotation.end) <= tolerance + annotation.width * 1.5) return annotation
    } else {
      const bounds = annotationBounds(annotation)
      if (!bounds) continue
      if (point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance && point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance) return annotation
    }
  }
  return null
}

function annotationHandle(annotation: ImageEditorAnnotation, point: ImageEditorPoint) {
  const threshold = 28
  if (annotation.type === 'arrow') {
    if (pointDistance(point, annotation.start) <= threshold) return 'start' as const
    if (pointDistance(point, annotation.end) <= threshold) return 'end' as const
  }
  if (annotation.type === 'shape' && pointDistance(point, annotation.end) <= threshold) return 'end' as const
  return null
}

function moveAnnotation(annotation: ImageEditorAnnotation, delta: ImageEditorPoint): ImageEditorAnnotation {
  if (annotation.type === 'stroke' || annotation.type === 'mosaic') return { ...annotation, points: annotation.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })) }
  if (annotation.type === 'text') return { ...annotation, position: { x: annotation.position.x + delta.x, y: annotation.position.y + delta.y } }
  return {
    ...annotation,
    start: { x: annotation.start.x + delta.x, y: annotation.start.y + delta.y },
    end: { x: annotation.end.x + delta.x, y: annotation.end.y + delta.y },
  }
}

function duplicateAnnotation(annotation: ImageEditorAnnotation, imageWidth: number, imageHeight: number) {
  const id = createImageEditorId(`${annotation.type}-copy`)
  const translated = { ...moveAnnotation(annotation, { x: 20, y: 20 }), id }
  const bounds = annotationBounds(translated)
  if (!bounds) return translated
  const correctionX = bounds.x < 0 ? -bounds.x : bounds.x + bounds.width > imageWidth ? imageWidth - bounds.x - bounds.width : 0
  const correctionY = bounds.y < 0 ? -bounds.y : bounds.y + bounds.height > imageHeight ? imageHeight - bounds.y - bounds.height : 0
  return { ...moveAnnotation(translated, { x: correctionX, y: correctionY }), id }
}

function resizeAnnotation(annotation: ImageEditorAnnotation, handle: 'start' | 'end', point: ImageEditorPoint): ImageEditorAnnotation {
  if (annotation.type === 'arrow') return handle === 'start' ? { ...annotation, start: point } : { ...annotation, end: point }
  if (annotation.type === 'shape') return { ...annotation, end: point }
  return annotation
}

function clampCropRect(rect: ImageEditorRect, width: number, height: number): ImageEditorRect {
  const x = clamp(rect.x, 0, Math.max(0, width - 1))
  const y = clamp(rect.y, 0, Math.max(0, height - 1))
  return {
    x,
    y,
    width: clamp(rect.width, 1, Math.max(1, width - x)),
    height: clamp(rect.height, 1, Math.max(1, height - y)),
  }
}

function cropFromDrag(start: ImageEditorPoint, end: ImageEditorPoint, ratio: CropRatio, width: number, height: number) {
  const directionX = end.x >= start.x ? 1 : -1
  const directionY = end.y >= start.y ? 1 : -1
  let crop = normalizeImageEditorRect(start, end)
  if (ratio !== 'free') {
    const [ratioWidth, ratioHeight] = ratio.split(':').map(Number)
    const targetRatio = ratioWidth / ratioHeight
    let cropWidth = Math.max(1, crop.width)
    let cropHeight = Math.max(1, crop.height)
    if (cropWidth / cropHeight > targetRatio) cropWidth = cropHeight * targetRatio
    else cropHeight = cropWidth / targetRatio
    crop = {
      x: directionX < 0 ? start.x - cropWidth : start.x,
      y: directionY < 0 ? start.y - cropHeight : start.y,
      width: cropWidth,
      height: cropHeight,
    }
  }
  return clampCropRect(crop, width, height)
}

function moveCrop(crop: ImageEditorRect, delta: ImageEditorPoint, width: number, height: number) {
  return clampCropRect({ ...crop, x: crop.x + delta.x, y: crop.y + delta.y }, width, height)
}

function resizeCrop(crop: ImageEditorRect, handle: CropHandle, point: ImageEditorPoint, width: number, height: number) {
  const right = crop.x + crop.width
  const bottom = crop.y + crop.height
  const minimum = 1
  let left = crop.x
  let top = crop.y
  let nextRight = right
  let nextBottom = bottom
  if (handle.includes('w')) left = clamp(point.x, 0, nextRight - minimum)
  if (handle.includes('e')) nextRight = clamp(point.x, left + minimum, width)
  if (handle.includes('n')) top = clamp(point.y, 0, nextBottom - minimum)
  if (handle.includes('s')) nextBottom = clamp(point.y, top + minimum, height)
  return clampCropRect({ x: left, y: top, width: nextRight - left, height: nextBottom - top }, width, height)
}

function cropHandleAt(crop: ImageEditorRect, point: ImageEditorPoint): CropHandle | null {
  const threshold = Math.max(18, Math.min(crop.width, crop.height) * 0.08)
  const handles: Array<[CropHandle, ImageEditorPoint]> = [
    ['nw', { x: crop.x, y: crop.y }],
    ['ne', { x: crop.x + crop.width, y: crop.y }],
    ['sw', { x: crop.x, y: crop.y + crop.height }],
    ['se', { x: crop.x + crop.width, y: crop.y + crop.height }],
  ]
  return handles.find(([, handle]) => pointDistance(point, handle) <= threshold)?.[0] || null
}

function pointInCrop(crop: ImageEditorRect, point: ImageEditorPoint) {
  return point.x >= crop.x && point.x <= crop.x + crop.width && point.y >= crop.y && point.y <= crop.y + crop.height
}

function appendInterpolatedPoints(points: ImageEditorPoint[], next: ImageEditorPoint, spacing: number) {
  const last = points[points.length - 1]
  if (!last) return [next]
  const distance = pointDistance(last, next)
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, spacing)))
  const result = points.slice()
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps
    result.push({ x: last.x + (next.x - last.x) * progress, y: last.y + (next.y - last.y) * progress })
  }
  return result
}

function sameState(left: ImageEditorState, right: ImageEditorState) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buttonClass(active = false) {
  return `min-h-10 shrink-0 border px-3 text-xs font-black transition ${active ? 'border-sky-300 bg-sky-500 text-white' : 'border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/15'}`
}

function iconButtonClass() {
  return 'grid size-10 place-items-center rounded-md border border-white/15 bg-slate-950/55 text-white/70 opacity-75 shadow-lg backdrop-blur-sm transition hover:border-white/35 hover:bg-slate-900/80 hover:text-white hover:opacity-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30'
}

export function ImageEditor({ file, onCancel, onComplete }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  const floatingPositionUpdateRef = useRef<() => void>(() => undefined)
  const decodedRef = useRef<DecodedImageEditorImage | null>(null)
  const renderRef = useRef<RenderedImageEditorCanvas | null>(null)
  const historyRef = useRef<ImageEditorState[]>([createInitialImageEditorState()])
  const historyIndexRef = useRef(0)
  const stateRef = useRef(historyRef.current[0])
  const interactionRef = useRef<Interaction | null>(null)
  const pendingPointRef = useRef<ImageEditorPoint | null>(null)
  const interactionFrameRef = useRef<number | null>(null)
  const lastQueuedPointRef = useRef<ImageEditorPoint | null>(null)
  const exportingRef = useRef(false)
  const [decoded, setDecoded] = useState<DecodedImageEditorImage | null>(null)
  const [decodeError, setDecodeError] = useState('')
  const [history, setHistory] = useState<ImageEditorState[]>(historyRef.current)
  const [historyIndex, setHistoryIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [floatingSelection, setFloatingSelection] = useState<FloatingSelectionPosition | null>(null)
  const [tool, setTool] = useState<ImageEditorTool>('select')
  const [shape, setShape] = useState<ImageEditorShape>('rect')
  const [cropRatio, setCropRatio] = useState<CropRatio>('free')
  const [color, setColor] = useState(COLORS[0])
  const [strokeWidth, setStrokeWidth] = useState(6)
  const [fontSize, setFontSize] = useState(34)
  const [mosaicBrushSize, setMosaicBrushSize] = useState(42)
  const [mosaicPixelSize, setMosaicPixelSize] = useState(18)
  const [textDraft, setTextDraft] = useState('')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const state = history[historyIndex] || stateRef.current
  stateRef.current = state
  historyRef.current = history
  historyIndexRef.current = historyIndex
  exportingRef.current = exporting

  function updateFloatingSelectionPosition() {
    const annotation = selectedId ? stateRef.current.annotations.find((candidate) => candidate.id === selectedId) : null
    const canvas = canvasRef.current
    const rendered = renderRef.current
    const bounds = annotation ? annotationBounds(annotation) : null
    if (!annotation || !canvas || !rendered || !bounds) {
      setFloatingSelection(null)
      return
    }

    const canvasRect = canvas.getBoundingClientRect()
    const viewWidth = Math.max(1, rendered.viewRect.width)
    const viewHeight = Math.max(1, rendered.viewRect.height)
    const scaleX = canvasRect.width / viewWidth
    const scaleY = canvasRect.height / viewHeight
    const boundsLeft = canvasRect.left + (bounds.x - rendered.viewRect.x) * scaleX
    const boundsTop = canvasRect.top + (bounds.y - rendered.viewRect.y) * scaleY
    const boundsRight = boundsLeft + bounds.width * scaleX
    const boundsBottom = boundsTop + bounds.height * scaleY
    const buttonSize = 40
    const edge = 8
    const contentTop = (mainRef.current?.getBoundingClientRect().top || 0) + edge
    const footerTop = footerRef.current?.getBoundingClientRect().top || window.innerHeight
    const maxTop = Math.max(contentTop, footerTop - buttonSize - edge)
    const clampToViewport = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
    const next = {
      deleteLeft: clampToViewport(boundsRight + edge, edge, Math.max(edge, window.innerWidth - buttonSize - edge)),
      deleteTop: clampToViewport(boundsTop - buttonSize / 2, contentTop, maxTop),
      copyLeft: clampToViewport(boundsLeft, edge, Math.max(edge, window.innerWidth - buttonSize - edge)),
      copyTop: clampToViewport(boundsBottom + edge, contentTop, maxTop),
    }
    setFloatingSelection((previous) => previous && Object.keys(next).every((key) => previous[key as keyof FloatingSelectionPosition] === next[key as keyof FloatingSelectionPosition]) ? previous : next)
  }

  floatingPositionUpdateRef.current = updateFloatingSelectionPosition

  useEffect(() => {
    let alive = true
    let loaded: DecodedImageEditorImage | null = null
    const initial = createInitialImageEditorState()
    historyRef.current = [initial]
    historyIndexRef.current = 0
    stateRef.current = initial
    interactionRef.current = null
    setHistory([initial])
    setHistoryIndex(0)
    setSelectedId(null)
    setTextDraft('')
    setDecoded(null)
    setDecodeError('')
    void decodeImageForEditor(file).then((next) => {
      loaded = next
      if (!alive) {
        next.cleanup()
        return
      }
      decodedRef.current = next
      setDecoded(next)
    }).catch((reason) => {
      if (alive) setDecodeError(reason instanceof Error ? reason.message : '图片无法编辑')
    })
    return () => {
      alive = false
      loaded?.cleanup()
      decodedRef.current = null
      renderRef.current = null
    }
  }, [file])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('image-editor-open')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exportingRef.current) onCancel()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.classList.remove('image-editor-open')
      window.removeEventListener('keydown', onKeyDown)
      if (interactionFrameRef.current !== null) window.cancelAnimationFrame(interactionFrameRef.current)
      interactionFrameRef.current = null
      pendingPointRef.current = null
    }
  }, [onCancel])

  useEffect(() => {
    if (!decoded || !canvasRef.current) return
    try {
      const rendered = renderImageEditorState(decoded, state, IMAGE_EDITOR_PREVIEW_MAX_EDGE, selectedId, { showCropOverlay: tool === 'crop' })
      renderRef.current = rendered
      const canvas = canvasRef.current
      canvas.width = rendered.width
      canvas.height = rendered.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器不支持图片画布')
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(rendered.canvas, 0, 0)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片预览失败')
    }
  }, [decoded, selectedId, state, tool])

  useEffect(() => {
    const update = () => floatingPositionUpdateRef.current()
    window.addEventListener('resize', update)
    update()
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    floatingPositionUpdateRef.current()
  }, [decoded, selectedId, state, tool])

  function replaceCurrentState(next: ImageEditorState) {
    const cloned = cloneImageEditorState(next)
    const index = historyIndexRef.current
    const nextHistory = historyRef.current.slice()
    nextHistory[index] = cloned
    historyRef.current = nextHistory
    stateRef.current = cloned
    setHistory(nextHistory)
  }

  function commitState(next: ImageEditorState) {
    const cloned = cloneImageEditorState(next)
    const currentIndex = historyIndexRef.current
    const nextHistory = [...historyRef.current.slice(0, currentIndex + 1), cloned]
    const nextIndex = nextHistory.length - 1
    historyRef.current = nextHistory
    historyIndexRef.current = nextIndex
    stateRef.current = cloned
    setHistory(nextHistory)
    setHistoryIndex(nextIndex)
  }

  function commitInteraction() {
    const interaction = interactionRef.current
    if (!interaction) return
    const current = stateRef.current
    if (!interaction.changed || sameState(interaction.baseState, current)) {
      const restored = historyRef.current.slice()
      restored[interaction.baseIndex] = interaction.baseState
      historyRef.current = restored
      historyIndexRef.current = interaction.baseIndex
      stateRef.current = interaction.baseState
      setHistory(restored)
      setHistoryIndex(interaction.baseIndex)
    } else {
      const nextHistory = [...historyRef.current.slice(0, interaction.baseIndex), cloneImageEditorState(current)]
      const nextIndex = nextHistory.length - 1
      historyRef.current = nextHistory
      historyIndexRef.current = nextIndex
      stateRef.current = nextHistory[nextIndex]
      setHistory(nextHistory)
      setHistoryIndex(nextIndex)
    }
    interactionRef.current = null
  }

  function undo() {
    if (interactionRef.current) return
    const nextIndex = Math.max(0, historyIndexRef.current - 1)
    historyIndexRef.current = nextIndex
    stateRef.current = historyRef.current[nextIndex]
    setHistoryIndex(nextIndex)
    setSelectedId(null)
  }

  function redo() {
    if (interactionRef.current) return
    const nextIndex = Math.min(historyRef.current.length - 1, historyIndexRef.current + 1)
    historyIndexRef.current = nextIndex
    stateRef.current = historyRef.current[nextIndex]
    setHistoryIndex(nextIndex)
    setSelectedId(null)
  }

  function chooseTool(nextTool: ImageEditorTool) {
    setTool(nextTool)
    setError('')
    const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
    if (nextTool === 'text' && selected?.type === 'text') {
      setTextDraft(selected.text)
      setFontSize(selected.fontSize)
      setColor(selected.color)
    } else if ((nextTool === 'draw' || nextTool === 'shape' || nextTool === 'arrow') && selected && 'color' in selected && 'width' in selected) {
      setColor(selected.color)
      setStrokeWidth(selected.width)
    } else if (nextTool === 'mosaic' && selected?.type === 'mosaic') {
      setMosaicBrushSize(selected.width)
      setMosaicPixelSize(selected.pixelSize ?? 18)
    }
  }

  function currentPoint(event: { clientX: number; clientY: number }) {
    if (!canvasRef.current || !decoded) return null
    const viewRect = renderRef.current?.viewRect || imageEditorViewRect(decoded.width, decoded.height, stateRef.current)
    return clientPointToImagePoint(event.clientX, event.clientY, canvasRef.current, viewRect)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!decoded || exporting || decodeError) return
    const point = currentPoint(event)
    if (!point) return
    event.preventDefault()
    if (event.pointerType !== 'mouse') event.currentTarget.setPointerCapture(event.pointerId)
    if (interactionFrameRef.current !== null) window.cancelAnimationFrame(interactionFrameRef.current)
    interactionFrameRef.current = null
    pendingPointRef.current = null
    lastQueuedPointRef.current = null
    const baseState = cloneImageEditorState(stateRef.current)
    const baseIndex = historyIndexRef.current

    if (tool === 'select') {
      const selected = hitTestAnnotation(baseState, point)
      setSelectedId(selected?.id || null)
      if (!selected) return
      const handle = annotationHandle(selected, point)
      interactionRef.current = { baseIndex, baseState, mode: handle ? 'resize' : 'move', id: selected.id, handle: handle || undefined, start: point, changed: false }
      return
    }

    const dimensions = imageEditorDimensions(decoded.width, decoded.height, baseState.rotation)
    if (tool === 'crop') {
      const currentCrop = baseState.crop
      const handle = currentCrop ? cropHandleAt(currentCrop, point) : null
      const mode = handle ? 'crop-resize' : currentCrop && pointInCrop(currentCrop, point) ? 'crop-move' : 'crop-new'
      interactionRef.current = { baseIndex, baseState, mode, handle: handle || undefined, start: point, changed: false }
      return
    }
    if (tool === 'draw' || tool === 'mosaic') {
      const annotation: ImageEditorAnnotation = tool === 'mosaic'
        ? { id: createImageEditorId('mosaic'), type: 'mosaic', points: [point], color: '#000000', width: mosaicBrushSize, pixelSize: mosaicPixelSize }
        : { id: createImageEditorId('stroke'), type: 'stroke', points: [point], color, width: strokeWidth }
      replaceCurrentState({ ...baseState, annotations: [...baseState.annotations, annotation] })
      interactionRef.current = { baseIndex, baseState, mode: 'draw', id: annotation.id, start: point, changed: true }
      setSelectedId(annotation.id)
      return
    }
    if (tool === 'shape') {
      const annotation: ImageEditorAnnotation = { id: createImageEditorId('shape'), type: 'shape', shape, start: point, end: point, color, width: strokeWidth }
      replaceCurrentState({ ...baseState, annotations: [...baseState.annotations, annotation] })
      interactionRef.current = { baseIndex, baseState, mode: 'draw', id: annotation.id, start: point, changed: true }
      setSelectedId(annotation.id)
      return
    }
    if (tool === 'arrow') {
      const annotation: ImageEditorAnnotation = { id: createImageEditorId('arrow'), type: 'arrow', start: point, end: point, color, width: strokeWidth }
      replaceCurrentState({ ...baseState, annotations: [...baseState.annotations, annotation] })
      interactionRef.current = { baseIndex, baseState, mode: 'draw', id: annotation.id, start: point, changed: true }
      setSelectedId(annotation.id)
      return
    }
    if (tool === 'text') {
      const existing = hitTestAnnotation(baseState, point)
      if (existing?.type === 'text') {
        setSelectedId(existing.id)
        setTextDraft(existing.text)
        setFontSize(existing.fontSize)
        setColor(existing.color)
        interactionRef.current = { baseIndex, baseState, mode: 'move', id: existing.id, start: point, changed: false }
        return
      }
      const text = textDraft.trim()
      if (!text) {
        setError('请先输入文字，再点击图片放置。')
        return
      }
      const annotation: ImageEditorAnnotation = { id: createImageEditorId('text'), type: 'text', position: point, text, color, fontSize }
      replaceCurrentState({ ...baseState, annotations: [...baseState.annotations, annotation] })
      interactionRef.current = { baseIndex, baseState, mode: 'draw', id: annotation.id, start: point, changed: true }
      setSelectedId(annotation.id)
      return
    }
    void dimensions
  }

  function applyInteractionPoint(point: ImageEditorPoint) {
    const interaction = interactionRef.current
    if (!interaction || !decoded) return
    const current = stateRef.current
    const dimensions = imageEditorDimensions(decoded.width, decoded.height, current.rotation)
    let next = interaction.baseState

    if (interaction.mode === 'crop-new') {
      next = { ...interaction.baseState, crop: cropFromDrag(interaction.start, point, cropRatio, dimensions.width, dimensions.height) }
    } else if (interaction.mode === 'crop-move' && interaction.baseState.crop) {
      next = { ...interaction.baseState, crop: moveCrop(interaction.baseState.crop, { x: point.x - interaction.start.x, y: point.y - interaction.start.y }, dimensions.width, dimensions.height) }
    } else if (interaction.mode === 'crop-resize' && interaction.baseState.crop && interaction.handle) {
      next = { ...interaction.baseState, crop: resizeCrop(interaction.baseState.crop, interaction.handle as CropHandle, point, dimensions.width, dimensions.height) }
    } else if (interaction.id) {
      const baseTarget = interaction.baseState.annotations.find((annotation) => annotation.id === interaction.id)
      const currentTarget = current.annotations.find((annotation) => annotation.id === interaction.id)
      if (!currentTarget || (interaction.mode !== 'draw' && !baseTarget)) return
      const targetForInteraction: ImageEditorAnnotation = baseTarget || currentTarget
      let updated: ImageEditorAnnotation = targetForInteraction
      if (interaction.mode === 'draw') {
        if (currentTarget.type === 'stroke' || currentTarget.type === 'mosaic') {
          updated = { ...currentTarget, points: appendInterpolatedPoints(currentTarget.points, point, currentTarget.type === 'mosaic' ? currentTarget.width / 2 : Math.max(1, currentTarget.width / 2)) }
        } else if (currentTarget.type === 'shape' || currentTarget.type === 'arrow') {
          updated = { ...currentTarget, end: point }
        } else if (currentTarget.type === 'text') {
          updated = { ...currentTarget, position: point }
        }
      } else if (interaction.mode === 'move') {
        updated = moveAnnotation(targetForInteraction, { x: point.x - interaction.start.x, y: point.y - interaction.start.y })
      } else if (interaction.mode === 'resize' && interaction.handle && (interaction.handle === 'start' || interaction.handle === 'end')) {
        updated = resizeAnnotation(targetForInteraction, interaction.handle, point)
      }
      const hasTargetInBase = interaction.baseState.annotations.some((annotation) => annotation.id === interaction.id)
      next = {
        ...interaction.baseState,
        annotations: hasTargetInBase
          ? interaction.baseState.annotations.map((annotation) => annotation.id === interaction.id ? updated : annotation)
          : [...interaction.baseState.annotations, updated],
      }
    }
    interaction.changed = true
    replaceCurrentState(next)
  }

  function flushInteractionFrame() {
    if (interactionFrameRef.current !== null) window.cancelAnimationFrame(interactionFrameRef.current)
    interactionFrameRef.current = null
    const point = pendingPointRef.current
    pendingPointRef.current = null
    if (point) applyInteractionPoint(point)
  }

  function queueInteractionPoint(point: ImageEditorPoint) {
    const previous = lastQueuedPointRef.current
    if (previous && pointDistance(previous, point) < 0.5) return
    lastQueuedPointRef.current = point
    pendingPointRef.current = point
    if (interactionFrameRef.current !== null) return
    interactionFrameRef.current = window.requestAnimationFrame(() => {
      interactionFrameRef.current = null
      const nextPoint = pendingPointRef.current
      pendingPointRef.current = null
      if (nextPoint) applyInteractionPoint(nextPoint)
    })
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const interaction = interactionRef.current
    if (!interaction || !decoded) return
    const point = currentPoint(event)
    if (!point) return
    event.preventDefault()
    queueInteractionPoint(point)
  }

  function handleMouseMove(event: ReactMouseEvent<HTMLCanvasElement>) {
    const interaction = interactionRef.current
    if (!interaction || !decoded || event.buttons === 0) return
    const point = currentPoint(event)
    if (!point) return
    event.preventDefault()
    queueInteractionPoint(point)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = interactionRef.current ? currentPoint(event) : null
    if (point) pendingPointRef.current = point
    flushInteractionFrame()
    lastQueuedPointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    commitInteraction()
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (interactionFrameRef.current !== null) window.cancelAnimationFrame(interactionFrameRef.current)
    interactionFrameRef.current = null
    pendingPointRef.current = null
    lastQueuedPointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const interaction = interactionRef.current
    if (!interaction) return
    const restored = historyRef.current.slice()
    restored[interaction.baseIndex] = interaction.baseState
    historyRef.current = restored
    historyIndexRef.current = interaction.baseIndex
    stateRef.current = interaction.baseState
    setHistory(restored)
    setHistoryIndex(interaction.baseIndex)
    interactionRef.current = null
  }

  function removeSelected() {
    const id = selectedId
    if (!id) return
    commitState({ ...stateRef.current, annotations: stateRef.current.annotations.filter((annotation) => annotation.id !== id) })
    setSelectedId(null)
  }

  function copySelected() {
    if (!decoded || !selectedId || exporting) return
    const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
    if (!selected) return
    const dimensions = imageEditorDimensions(decoded.width, decoded.height, stateRef.current.rotation)
    const copy = duplicateAnnotation(selected, dimensions.width, dimensions.height)
    commitState({ ...stateRef.current, annotations: [...stateRef.current.annotations, copy] })
    setSelectedId(copy.id)
  }

  function rotate() {
    if (!decoded || exporting) return
    commitState(rotateImageEditorState(stateRef.current, decoded.width, decoded.height))
    setSelectedId(null)
  }

  function restoreOriginal() {
    commitState(createInitialImageEditorState())
    setSelectedId(null)
    setTextDraft('')
  }

  function clearCrop() {
    if (!stateRef.current.crop) return
    commitState({ ...stateRef.current, crop: null })
  }

  function changeTextDraft(value: string) {
    setTextDraft(value)
    if (!selectedId) return
    const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
    if (selected?.type !== 'text') return
    commitState({
      ...stateRef.current,
      annotations: stateRef.current.annotations.map((annotation) => annotation.id === selectedId && annotation.type === 'text' ? { ...annotation, text: value } : annotation),
    })
  }

  function changeColor(nextColor: string) {
    setColor(nextColor)
    const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
    if (!selected || !('color' in selected)) return
    commitState({
      ...stateRef.current,
      annotations: stateRef.current.annotations.map((annotation) => annotation.id === selectedId && 'color' in annotation ? { ...annotation, color: nextColor } : annotation),
    })
  }

  function changeWidth(nextWidth: number) {
    if (tool === 'mosaic') {
      setMosaicBrushSize(nextWidth)
      const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
      if (selected?.type === 'mosaic') {
        commitState({
          ...stateRef.current,
          annotations: stateRef.current.annotations.map((annotation) => annotation.id === selectedId && annotation.type === 'mosaic' ? { ...annotation, width: nextWidth } : annotation),
        })
      }
      return
    }
    setStrokeWidth(nextWidth)
    const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
    if (!selected || !('width' in selected)) return
    commitState({
      ...stateRef.current,
      annotations: stateRef.current.annotations.map((annotation) => annotation.id === selectedId && 'width' in annotation ? { ...annotation, width: nextWidth } : annotation),
    })
  }

  function changeFontSize(nextFontSize: number) {
    setFontSize(nextFontSize)
    const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
    if (selected?.type !== 'text') return
    commitState({
      ...stateRef.current,
      annotations: stateRef.current.annotations.map((annotation) => annotation.id === selectedId && annotation.type === 'text' ? { ...annotation, fontSize: nextFontSize } : annotation),
    })
  }

  function changeMosaicPixelSize(nextPixelSize: number) {
    setMosaicPixelSize(nextPixelSize)
    const selected = stateRef.current.annotations.find((annotation) => annotation.id === selectedId)
    if (selected?.type !== 'mosaic') return
    commitState({
      ...stateRef.current,
      annotations: stateRef.current.annotations.map((annotation) => annotation.id === selectedId && annotation.type === 'mosaic' ? { ...annotation, pixelSize: nextPixelSize } : annotation),
    })
  }

  async function complete() {
    if (!decoded || exporting) return
    setExporting(true)
    setError('')
    try {
      const editedFile = await exportImageEditorFile(decoded, stateRef.current, file.name)
      onComplete(editedFile)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片导出失败')
    } finally {
      setExporting(false)
    }
  }

  const editorDisabled = !decoded || Boolean(decodeError) || exporting
  const layer = (
    <div data-image-editor-overlay className="fixed inset-0 z-[100200] flex min-h-0 flex-col bg-slate-950 text-white" style={{ zIndex: 100200 }} role="dialog" aria-modal="true" aria-label="图片编辑">
      <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 sm:px-5">
        <button type="button" onClick={onCancel} disabled={exporting} className="min-h-10 px-2 text-sm font-black text-white/75 disabled:opacity-40">取消</button>
        <strong className="text-sm font-black tracking-wide">图片编辑</strong>
        <button type="button" onClick={() => void complete()} disabled={editorDisabled} className="min-h-10 bg-sky-500 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{exporting ? '导出中…' : '完成'}</button>
      </header>

      <main ref={mainRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6">
        <div className="pointer-events-none absolute right-3 top-3 z-20 flex gap-2">
          <button type="button" onClick={undo} disabled={historyIndex <= 0 || exporting} className={`${iconButtonClass()} pointer-events-auto`} aria-label="撤销" title="撤销"><UiIcon name="undo" className="size-5" /></button>
          <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1 || exporting} className={`${iconButtonClass()} pointer-events-auto`} aria-label="重做" title="重做"><UiIcon name="redo" className="size-5" /></button>
        </div>
        {decodeError ? <div className="max-w-sm space-y-3 text-center"><p className="text-sm font-bold text-rose-300">{decodeError}</p><p className="text-xs font-bold text-white/55">这张图片无法在当前浏览器中编辑，可以取消并按原有流程继续上传。</p></div> : null}
        {!decodeError && !decoded ? <p className="text-sm font-bold text-white/65">正在准备图片…</p> : null}
        {decoded ? <canvas ref={canvasRef} className="block max-h-full max-w-full bg-black object-contain shadow-2xl" style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }} onContextMenu={(event) => event.preventDefault()} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onMouseMove={handleMouseMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} aria-label="图片编辑画布" /> : null}
        {selectedId && floatingSelection ? <>
          <button type="button" data-image-editor-floating-delete onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeSelected() }} disabled={exporting} className={`${iconButtonClass()} fixed z-30 text-rose-200`} style={{ left: floatingSelection.deleteLeft, top: floatingSelection.deleteTop }} aria-label="删除当前标注" title="删除当前标注"><UiIcon name="trash" className="size-5" /></button>
          <button type="button" data-image-editor-floating-copy onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); copySelected() }} disabled={exporting} className={`${iconButtonClass()} fixed z-30`} style={{ left: floatingSelection.copyLeft, top: floatingSelection.copyTop }} aria-label="复制当前标注" title="复制当前标注"><span className="relative grid size-6 place-items-center"><UiIcon name="copy" className="size-5" /><span aria-hidden="true" className="absolute -right-2 -top-2 text-[9px] font-black leading-none text-sky-200">+1</span></span></button>
        </> : null}
      </main>

      <footer ref={footerRef} className="shrink-0 border-t border-white/10 bg-slate-900/95 pb-[env(safe-area-inset-bottom)]">
        <div className="flex gap-2 overflow-x-auto px-3 py-2 sm:justify-center">
          <button type="button" disabled={editorDisabled} className={buttonClass(tool === 'select')} onClick={() => chooseTool('select')}>选择</button>
          <button type="button" disabled={editorDisabled} className={buttonClass(tool === 'crop')} onClick={() => chooseTool('crop')}>裁剪</button>
          <button type="button" disabled={editorDisabled} className={buttonClass(false)} onClick={rotate}>旋转</button>
          <button type="button" disabled={editorDisabled} className={buttonClass(tool === 'draw')} onClick={() => chooseTool('draw')}>画笔</button>
          <button type="button" disabled={editorDisabled} className={buttonClass(tool === 'shape')} onClick={() => chooseTool('shape')}>形状</button>
          <button type="button" disabled={editorDisabled} className={buttonClass(tool === 'arrow')} onClick={() => chooseTool('arrow')}>箭头</button>
          <button type="button" disabled={editorDisabled} className={buttonClass(tool === 'text')} onClick={() => chooseTool('text')}>文字</button>
          <button type="button" disabled={editorDisabled} className={buttonClass(tool === 'mosaic')} onClick={() => chooseTool('mosaic')}>马赛克</button>
        </div>

        <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 pb-2 text-xs font-bold sm:justify-center">
          {tool === 'select' ? <span className="text-white/55">{selectedId ? '已选择标注，可拖动调整' : '选择模式'}</span> : null}
          {tool === 'crop' ? <>
            <label className="flex items-center gap-2 text-white/75">比例<select value={cropRatio} onChange={(event) => setCropRatio(event.target.value as CropRatio)} className="min-h-9 border border-white/15 bg-slate-800 px-2 text-xs text-white"><option value="free">自由</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option></select></label>
            <button type="button" onClick={clearCrop} disabled={!state.crop || exporting} className={buttonClass(false)}>清除裁剪</button>
          </> : null}
          {tool === 'shape' ? <label className="flex items-center gap-2 text-white/75">形状<select value={shape} onChange={(event) => setShape(event.target.value as ImageEditorShape)} className="min-h-9 border border-white/15 bg-slate-800 px-2 text-xs text-white"><option value="rect">矩形</option><option value="ellipse">圆 / 椭圆</option></select></label> : null}
          {tool === 'text' ? <label className="flex min-w-56 flex-1 items-center gap-2 text-white/75 sm:flex-none">文字<input value={textDraft} onChange={(event) => changeTextDraft(event.target.value)} placeholder="点击图片放置文字" maxLength={120} className="min-h-9 min-w-0 flex-1 border border-white/15 bg-slate-800 px-2 text-white placeholder:text-white/35 sm:w-64" /></label> : null}
          {tool === 'draw' || tool === 'shape' || tool === 'arrow' || tool === 'text' ? <>
            <span className="ml-1 text-white/55">颜色</span>
            {COLORS.map((candidate) => <button key={candidate} type="button" onClick={() => changeColor(candidate)} aria-label={`选择颜色 ${candidate}`} className={`size-7 border-2 ${color === candidate ? 'border-white' : 'border-white/20'}`} style={{ backgroundColor: candidate }} />)}
          </> : null}
          {tool === 'draw' || tool === 'shape' || tool === 'arrow' ? <label className="ml-1 flex items-center gap-2 text-white/55">粗细<input type="range" min="2" max="48" value={strokeWidth} onChange={(event) => changeWidth(Number(event.target.value))} /></label> : null}
          {tool === 'text' ? <label className="flex items-center gap-2 text-white/55">字号<input type="range" min="12" max="120" value={fontSize} onChange={(event) => changeFontSize(Number(event.target.value))} /></label> : null}
          {tool === 'mosaic' ? <>
            <label className="flex items-center gap-2 text-white/55">笔刷<input type="range" min="12" max="120" value={mosaicBrushSize} onChange={(event) => changeWidth(Number(event.target.value))} /></label>
            <label className="flex items-center gap-2 text-white/55">像素<input type="range" min="6" max="48" value={mosaicPixelSize} onChange={(event) => changeMosaicPixelSize(Number(event.target.value))} /></label>
          </> : null}
        </div>

        <div className="flex items-center justify-center gap-2 border-t border-white/10 px-3 py-2">
          <button type="button" onClick={restoreOriginal} disabled={editorDisabled} className="min-h-10 border border-amber-300/35 px-3 text-xs font-black text-amber-200 disabled:opacity-40">恢复原图</button>
        </div>
        {error ? <p className="px-3 pb-2 text-center text-xs font-bold text-rose-300" role="alert">{error}</p> : null}
      </footer>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(layer, document.body) : null
}
