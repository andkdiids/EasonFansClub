'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
  type ImageEditorShape,
  type ImageEditorState,
  type ImageEditorTool,
} from '@/lib/image-editor'
import {
  decodeImageForEditor,
  editorPointFromClient,
  exportImageEditorFile,
  IMAGE_EDITOR_PREVIEW_MAX_EDGE,
  renderImageEditorState,
  type DecodedImageEditorImage,
  type RenderedImageEditorCanvas,
} from '@/lib/image-editor-browser'

type ImageEditorProps = Readonly<{
  file: File
  onCancel: () => void
  onComplete: (file: File) => void
}>

type CropRatio = 'free' | '1:1' | '4:3' | '3:4' | '16:9'

type Interaction = {
  baseIndex: number
  baseState: ImageEditorState
  mode: 'draw' | 'crop' | 'move' | 'resize'
  id?: string
  handle?: 'start' | 'end'
  start: ImageEditorPoint
  changed: boolean
}

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
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  if (annotation.type === 'text') {
    return { x: annotation.position.x, y: annotation.position.y, width: Math.max(annotation.fontSize, annotation.text.length * annotation.fontSize * 0.6), height: annotation.fontSize * 1.3 }
  }
  return normalizeImageEditorRect(annotation.start, annotation.end)
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

function resizeAnnotation(annotation: ImageEditorAnnotation, handle: 'start' | 'end', point: ImageEditorPoint): ImageEditorAnnotation {
  if (annotation.type === 'arrow') return handle === 'start' ? { ...annotation, start: point } : { ...annotation, end: point }
  if (annotation.type === 'shape') return { ...annotation, end: point }
  return annotation
}

function cropFromDrag(start: ImageEditorPoint, end: ImageEditorPoint, ratio: CropRatio, width: number, height: number) {
  const directionX = end.x >= start.x ? 1 : -1
  const directionY = end.y >= start.y ? 1 : -1
  let crop = normalizeImageEditorRect(start, end)
  if (ratio !== 'free') {
    const [ratioWidth, ratioHeight] = ratio.split(':').map(Number)
    const targetRatio = ratioWidth / ratioHeight
    let cropWidth = crop.width
    let cropHeight = crop.height
    if (cropWidth / Math.max(cropHeight, 1) > targetRatio) cropWidth = cropHeight * targetRatio
    else cropHeight = cropWidth / targetRatio
    crop = {
      x: directionX < 0 ? start.x - cropWidth : start.x,
      y: directionY < 0 ? start.y - cropHeight : start.y,
      width: cropWidth,
      height: cropHeight,
    }
  }
  const x = clamp(crop.x, 0, Math.max(0, width - 1))
  const y = clamp(crop.y, 0, Math.max(0, height - 1))
  return {
    x,
    y,
    width: clamp(crop.width, 1, Math.max(1, width - x)),
    height: clamp(crop.height, 1, Math.max(1, height - y)),
  }
}

function sameState(left: ImageEditorState, right: ImageEditorState) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buttonClass(active = false) {
  return `min-h-10 shrink-0 border px-3 text-xs font-black transition ${active ? 'border-sky-300 bg-sky-500 text-white' : 'border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/15'}`
}

export function ImageEditor({ file, onCancel, onComplete }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decodedRef = useRef<DecodedImageEditorImage | null>(null)
  const renderRef = useRef<RenderedImageEditorCanvas | null>(null)
  const historyRef = useRef<ImageEditorState[]>([createInitialImageEditorState()])
  const historyIndexRef = useRef(0)
  const stateRef = useRef(historyRef.current[0])
  const interactionRef = useRef<Interaction | null>(null)
  const [decoded, setDecoded] = useState<DecodedImageEditorImage | null>(null)
  const [decodeError, setDecodeError] = useState('')
  const [history, setHistory] = useState<ImageEditorState[]>(historyRef.current)
  const [historyIndex, setHistoryIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<ImageEditorTool>('select')
  const [shape, setShape] = useState<ImageEditorShape>('rect')
  const [cropRatio, setCropRatio] = useState<CropRatio>('free')
  const [color, setColor] = useState(COLORS[0])
  const [strokeWidth, setStrokeWidth] = useState(6)
  const [fontSize, setFontSize] = useState(34)
  const [textDraft, setTextDraft] = useState('')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const state = history[historyIndex] || stateRef.current
  stateRef.current = state
  historyRef.current = history
  historyIndexRef.current = historyIndex

  useEffect(() => {
    let alive = true
    let loaded: DecodedImageEditorImage | null = null
    const initial = createInitialImageEditorState()
    historyRef.current = [initial]
    historyIndexRef.current = 0
    stateRef.current = initial
    setHistory([initial])
    setHistoryIndex(0)
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) onCancel()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [exporting, onCancel])

  useEffect(() => {
    if (!decoded || !canvasRef.current) return
    try {
      const rendered = renderImageEditorState(decoded, state, IMAGE_EDITOR_PREVIEW_MAX_EDGE, selectedId)
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
  }, [decoded, selectedId, state])

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

  function currentPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canvasRef.current || !decoded) return null
    const viewRect = renderRef.current?.viewRect || imageEditorViewRect(decoded.width, decoded.height, stateRef.current)
    return editorPointFromClient(event.clientX, event.clientY, canvasRef.current, viewRect)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!decoded || exporting || decodeError) return
    const point = currentPoint(event)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
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
      interactionRef.current = { baseIndex, baseState, mode: 'crop', start: point, changed: false }
      return
    }
    if (tool === 'draw' || tool === 'mosaic') {
      const annotation: ImageEditorAnnotation = { id: createImageEditorId('stroke'), type: tool === 'mosaic' ? 'mosaic' : 'stroke', points: [point], color, width: tool === 'mosaic' ? Math.max(strokeWidth, 12) : strokeWidth }
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
        interactionRef.current = { baseIndex, baseState, mode: 'move', id: existing.id, start: point, changed: false }
        return
      }
      const text = textDraft.trim()
      if (!text) {
        setError('请先输入文字，再点击图片放置。')
        return
      }
      const annotation: ImageEditorAnnotation = { id: createImageEditorId('text'), type: 'text', position: point, text, color, fontSize, }
      replaceCurrentState({ ...baseState, annotations: [...baseState.annotations, annotation] })
      interactionRef.current = { baseIndex, baseState, mode: 'draw', id: annotation.id, start: point, changed: true }
      setSelectedId(annotation.id)
      return
    }
    // Keep TypeScript aware that the current dimensions are intentional: it
    // also prevents a crop gesture from ever leaving the image bounds.
    void dimensions
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const interaction = interactionRef.current
    if (!interaction || !decoded) return
    const point = currentPoint(event)
    if (!point) return
    event.preventDefault()
    const current = stateRef.current
    const dimensions = imageEditorDimensions(decoded.width, decoded.height, current.rotation)
    let next = interaction.baseState

    if (interaction.mode === 'crop') {
      const crop = cropFromDrag(interaction.start, point, cropRatio, dimensions.width, dimensions.height)
      next = { ...interaction.baseState, crop }
    } else if (interaction.id) {
      const target = interaction.baseState.annotations.find((annotation) => annotation.id === interaction.id)
      if (!target) return
      let updated: ImageEditorAnnotation = target
      if (interaction.mode === 'draw') {
        if (target.type === 'stroke' || target.type === 'mosaic') updated = { ...target, points: [...target.points, point] }
        else if (target.type === 'shape' || target.type === 'arrow') updated = { ...target, end: point }
        else if (target.type === 'text') updated = { ...target, position: point }
      } else if (interaction.mode === 'move') {
        updated = moveAnnotation(target, { x: point.x - interaction.start.x, y: point.y - interaction.start.y })
      } else if (interaction.mode === 'resize' && interaction.handle) {
        updated = resizeAnnotation(target, interaction.handle, point)
      }
      next = { ...interaction.baseState, annotations: interaction.baseState.annotations.map((annotation) => annotation.id === interaction.id ? updated : annotation) }
    }
    interaction.changed = true
    replaceCurrentState(next)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    commitInteraction()
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const interaction = interactionRef.current
    if (interaction) {
      const restored = historyRef.current.slice()
      restored[interaction.baseIndex] = interaction.baseState
      historyRef.current = restored
      historyIndexRef.current = interaction.baseIndex
      stateRef.current = interaction.baseState
      setHistory(restored)
      setHistoryIndex(interaction.baseIndex)
      interactionRef.current = null
    }
  }

  function removeSelected() {
    const id = selectedId
    if (!id) return
    commitState({ ...stateRef.current, annotations: stateRef.current.annotations.filter((annotation) => annotation.id !== id) })
    setSelectedId(null)
  }

  function rotate() {
    if (!decoded) return
    commitState(rotateImageEditorState(stateRef.current, decoded.width, decoded.height))
    setSelectedId(null)
  }

  function restoreOriginal() {
    if (!window.confirm('恢复原图？本次裁剪和标注都会清除。')) return
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

  const layer = (
    <div className="fixed inset-0 z-[120] flex min-h-0 flex-col bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label="图片编辑">
      <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 sm:px-5">
        <button type="button" onClick={onCancel} disabled={exporting} className="min-h-10 px-2 text-sm font-black text-white/75 disabled:opacity-40">取消</button>
        <strong className="text-sm font-black tracking-wide">图片编辑</strong>
        <button type="button" onClick={() => void complete()} disabled={!decoded || Boolean(decodeError) || exporting} className="min-h-10 bg-sky-500 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{exporting ? '导出中…' : '完成'}</button>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6">
        {decodeError ? <div className="max-w-sm space-y-3 text-center"><p className="text-sm font-bold text-rose-300">{decodeError}</p><p className="text-xs font-bold text-white/55">这张图片无法在当前浏览器中编辑，可以取消并按原有流程继续上传。</p></div> : null}
        {!decodeError && !decoded ? <p className="text-sm font-bold text-white/65">正在准备图片…</p> : null}
        {decoded ? <canvas ref={canvasRef} className="max-h-full max-w-full bg-black object-contain shadow-2xl" style={{ touchAction: 'none' }} onContextMenu={(event) => event.preventDefault()} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} aria-label="图片编辑画布" /> : null}
      </main>

      <footer className="shrink-0 border-t border-white/10 bg-slate-900/95 pb-[env(safe-area-inset-bottom)]">
        <div className="flex gap-2 overflow-x-auto px-3 py-2 sm:justify-center">
          <button type="button" className={buttonClass(tool === 'select')} onClick={() => setTool('select')}>选择</button>
          <button type="button" className={buttonClass(tool === 'crop')} onClick={() => setTool('crop')}>裁剪</button>
          <button type="button" className={buttonClass(false)} onClick={rotate}>旋转</button>
          <button type="button" className={buttonClass(tool === 'draw')} onClick={() => setTool('draw')}>画笔</button>
          <button type="button" className={buttonClass(tool === 'shape')} onClick={() => setTool('shape')}>形状</button>
          <button type="button" className={buttonClass(tool === 'arrow')} onClick={() => setTool('arrow')}>箭头</button>
          <button type="button" className={buttonClass(tool === 'text')} onClick={() => setTool('text')}>文字</button>
          <button type="button" className={buttonClass(tool === 'mosaic')} onClick={() => setTool('mosaic')}>马赛克</button>
        </div>

        <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 pb-2 text-xs font-bold sm:justify-center">
          {tool === 'crop' ? <>
            <label className="flex items-center gap-2 text-white/75">比例<select value={cropRatio} onChange={(event) => setCropRatio(event.target.value as CropRatio)} className="min-h-9 border border-white/15 bg-slate-800 px-2 text-xs text-white"><option value="free">自由</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option></select></label>
            <button type="button" onClick={clearCrop} disabled={!state.crop} className={buttonClass(false)}>清除裁剪</button>
          </> : null}
          {tool === 'shape' ? <label className="flex items-center gap-2 text-white/75">形状<select value={shape} onChange={(event) => setShape(event.target.value as ImageEditorShape)} className="min-h-9 border border-white/15 bg-slate-800 px-2 text-xs text-white"><option value="rect">矩形</option><option value="ellipse">圆 / 椭圆</option></select></label> : null}
          {tool === 'text' ? <label className="flex min-w-56 flex-1 items-center gap-2 text-white/75 sm:flex-none">文字<input value={textDraft} onChange={(event) => changeTextDraft(event.target.value)} placeholder="点击图片放置文字" maxLength={120} className="min-h-9 min-w-0 flex-1 border border-white/15 bg-slate-800 px-2 text-white placeholder:text-white/35 sm:w-64" /></label> : null}
          {tool === 'draw' || tool === 'shape' || tool === 'arrow' || tool === 'mosaic' || tool === 'text' ? <>
            <span className="ml-1 text-white/55">颜色</span>
            {COLORS.map((candidate) => <button key={candidate} type="button" onClick={() => setColor(candidate)} aria-label={`选择颜色 ${candidate}`} className={`size-7 border-2 ${color === candidate ? 'border-white' : 'border-white/20'}`} style={{ backgroundColor: candidate }} />)}
            <label className="ml-1 flex items-center gap-2 text-white/55">粗细<input type="range" min="2" max="24" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} /></label>
          </> : null}
          {tool === 'text' ? <label className="flex items-center gap-2 text-white/55">字号<input type="range" min="16" max="96" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label> : null}
          {selectedId ? <button type="button" onClick={removeSelected} className="ml-auto min-h-9 border border-rose-400/40 px-3 text-rose-200">删除选中标注</button> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 sm:justify-center">
          <div className="flex gap-2">
            <button type="button" onClick={undo} disabled={historyIndex <= 0 || exporting} className={buttonClass(false)}>撤销</button>
            <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1 || exporting} className={buttonClass(false)}>重做</button>
          </div>
          <button type="button" onClick={restoreOriginal} disabled={exporting} className="min-h-10 border border-amber-300/35 px-3 text-xs font-black text-amber-200 disabled:opacity-40">恢复原图</button>
        </div>
        {error ? <p className="px-3 pb-2 text-center text-xs font-bold text-rose-300" role="alert">{error}</p> : null}
      </footer>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(layer, document.body) : null
}
