'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { UiIcon } from '@/components/UiIcon'
import { shareContent } from '@/lib/share'
import { createStudioId, clearStudioDraft, deleteLocalStudioProject, getLocalStudioProject, readStudioDraft, recordStudioEvent, saveLocalStudioProject, writeStudioDraft } from '@/lib/studio/storage'
import { getStudioTool } from '@/lib/studio/tools'
import { createBeadPatternPdf } from '@/lib/studio/beads/pdf'
import { getDefaultPalette, getPalette, getSeriesForBrand, supportedBeadBrands } from '@/lib/studio/beads/palette'
import { calculateMaterialList, createDemoPattern, floodFill, replaceColor } from '@/lib/studio/beads/grid'
import { generatePatternFromImageInWorker } from '@/lib/studio/beads/image'
import { renderPatternToCanvas, renderPatternToDataUrl } from '@/lib/studio/beads/renderer'
import { EMPTY_CELL, type BeadPatternGrid, type BeadProjectData, type BeadSettings } from '@/lib/studio/beads/types'
import type { StudioExportFormat } from '@/lib/studio/tools'
import type { StudioLocalProject, StudioReviewStatus, StudioVisibility } from '@/lib/studio/types'
import { StudioToolShell, type StudioSaveStatus } from './StudioToolShell'
import styles from './studio.module.css'

const beadsTool = getStudioTool('beads')!

const defaultSettings: BeadSettings = {
  imageType: 'cartoon',
  width: 29,
  height: 29,
  lockRatio: true,
  cropRatio: '1:1',
  cropZoom: 1,
  cropX: 0,
  cropY: 0,
  rotation: 0,
  brand: 'MARD',
  series: '291',
  matchingMode: 'balanced',
  maxColors: 16,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  whiteAsEmpty: false,
  removeBackground: false,
  backgroundTolerance: 28,
  dithering: 'none',
  cleanupThreshold: 3,
}

type EditorTool = 'brush' | 'eraser' | 'eyedropper' | 'fill' | 'select' | 'pan'
type MobilePanel = 'settings' | 'preview' | 'materials'
type CellPatch = { index: number; before: number; after: number }
type GridSnapshot = { width: number; height: number; palette: BeadPatternGrid['palette']; cells: number[] }
type HistoryEntry = { patches: CellPatch[]; label: string; beforeGrid?: GridSnapshot; afterGrid?: GridSnapshot }
type PointerState = {
  kind: 'draw' | 'pan' | 'select' | 'craft' | null
  before: number[] | null
  changed: boolean
  lastCell: number
  lastX: number
  lastY: number
}
type PointerPoint = { x: number; y: number }
type PinchState = { distance: number; center: PointerPoint; zoom: number; pan: PointerPoint }
type Selection = { xStart: number; yStart: number; xEnd: number; yEnd: number }

function isBeadProjectData(value: unknown): value is BeadProjectData {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<BeadProjectData>
  const pattern = row.pattern
  const grid = pattern as Partial<BeadPatternGrid> | undefined
  if (!grid || typeof grid !== 'object') return false
  return row.tool === 'beads'
    && row.version === 1
    && Number.isInteger(grid.width) && Number.isInteger(grid.height)
    && grid.width! > 0 && grid.width! <= 200 && grid.height! > 0 && grid.height! <= 200
    && Array.isArray(grid.cells) && grid.cells.length === grid.width! * grid.height!
    && Array.isArray(grid.palette) && grid.palette.length > 0
    && grid.cells.every((cell) => Number.isInteger(cell) && (cell === EMPTY_CELL || (cell >= 0 && cell < grid.palette!.length)))
    && (row.completed === undefined || (Array.isArray(row.completed) && row.completed.every((index) => Number.isInteger(index) && index >= 0 && index < grid.cells!.length)))
}

function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  downloadUrl(url, filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 1200)
}

function sameCells(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

function diffCells(before: readonly number[], after: readonly number[]) {
  const patches: CellPatch[] = []
  const length = Math.max(before.length, after.length)
  for (let index = 0; index < length; index += 1) {
    const previous = before[index]
    const next = after[index]
    if (previous !== next && next !== undefined) patches.push({ index, before: previous ?? EMPTY_CELL, after: next })
  }
  return patches
}

function pointerDistance(left: PointerPoint, right: PointerPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function pointerCenter(left: PointerPoint, right: PointerPoint): PointerPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
}

function snapshotGrid(pattern: BeadPatternGrid): GridSnapshot {
  return { width: pattern.width, height: pattern.height, palette: [...pattern.palette], cells: [...pattern.cells] }
}

export function StudioBeadsTool({ isAuthenticated }: Readonly<{ isAuthenticated: boolean }>) {
  const searchParams = useSearchParams()
  const requestedProject = searchParams.get('project')
  const requestedMode = searchParams.get('mode')
  const requestedExport = searchParams.get('export') === '1'
  const [settings, setSettings] = useState<BeadSettings>(defaultSettings)
  const [pattern, setPattern] = useState<BeadPatternGrid>(() => createDemoPattern(getDefaultPalette()))
  const [title, setTitle] = useState('我的第一张图纸')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<StudioVisibility>('PRIVATE')
  const [reviewStatus, setReviewStatus] = useState<StudioReviewStatus>('NONE')
  const [saveStatus, setSaveStatus] = useState<StudioSaveStatus>('unsaved')
  const [loaded, setLoaded] = useState(false)
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [sourceImageName, setSourceImageName] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [activePanel, setActivePanel] = useState<MobilePanel>('preview')
  const [viewMode, setViewMode] = useState<'grid' | 'bead'>('grid')
  const [editorTool, setEditorTool] = useState<EditorTool>('brush')
  const [currentColorIndex, setCurrentColorIndex] = useState(5)
  const [displayGrid, setDisplayGrid] = useState(true)
  const [displayCodes, setDisplayCodes] = useState(true)
  const [displayCoordinates, setDisplayCoordinates] = useState(false)
  const [displayBoardLines, setDisplayBoardLines] = useState(true)
  const [transparentBackground, setTransparentBackground] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [completed, setCompleted] = useState<Set<number>>(() => new Set())
  const [craftMode, setCraftMode] = useState(false)
  const [craftColor, setCraftColor] = useState<number | null>(null)
  const [packSize, setPackSize] = useState(500)
  const [replaceWith, setReplaceWith] = useState(0)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const sourceImageRef = useRef<HTMLImageElement | null>(null)
  const sourceObjectUrlRef = useRef<string | null>(null)
  const patternRef = useRef(pattern)
  const pointerRef = useRef<PointerState>({ kind: null, before: null, changed: false, lastCell: -1, lastX: 0, lastY: 0 })
  const gestureCellsRef = useRef<number[] | null>(null)
  const pointersRef = useRef(new Map<number, PointerPoint>())
  const pinchRef = useRef<PinchState | null>(null)
  const selectionStartRef = useRef<number | null>(null)
  const craftCompletedRef = useRef<Set<number> | null>(null)
  const craftActionRef = useRef(true)

  useEffect(() => { patternRef.current = pattern }, [pattern])

  useEffect(() => {
    return () => {
      if (sourceObjectUrlRef.current) URL.revokeObjectURL(sourceObjectUrlRef.current)
      sourceObjectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === previewStageRef.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  const materials = useMemo(() => calculateMaterialList(pattern, packSize), [packSize, pattern])
  const progressCount = useMemo(() => [...completed].filter((index) => Number.isInteger(index) && index >= 0 && index < pattern.cells.length && pattern.cells[index] !== EMPTY_CELL).length, [completed, pattern])
  const progressPercent = materials.totalBeads ? Math.round(progressCount / materials.totalBeads * 1000) / 10 : 0
  const activeMaterial = materials.materials.find((material) => material.index === (craftColor ?? currentColorIndex))

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => current === message ? '' : current), 3600)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadProject() {
      let localProject = requestedProject ? await getLocalStudioProject(requestedProject) : null
      if (!localProject && requestedProject && isAuthenticated) {
        try {
          const response = await fetch(`/api/studio/projects/${encodeURIComponent(requestedProject)}`, { cache: 'no-store' })
          if (response.ok) {
            const body = await response.json() as { project?: Partial<StudioLocalProject> & { data?: unknown } }
            const remote = body.project
            if (remote && typeof remote.id === 'string' && typeof remote.title === 'string' && isBeadProjectData(remote.data)) {
              localProject = {
                id: remote.id,
                toolSlug: remote.toolSlug || 'beads',
                title: remote.title,
                description: remote.description,
                version: remote.version || 1,
                data: remote.data,
                thumbnailUrl: remote.thumbnailUrl,
                visibility: remote.visibility || 'PRIVATE',
                reviewStatus: remote.reviewStatus || 'NONE',
                createdAt: remote.createdAt || new Date().toISOString(),
                updatedAt: remote.updatedAt || new Date().toISOString(),
                lastOpenedAt: remote.lastOpenedAt,
                metadata: remote.metadata,
                supportedExportFormats: beadsTool.supportedExportFormats,
              }
              await saveLocalStudioProject(localProject)
            }
          }
        } catch {
          // The editor can still report a clear project-open failure below.
        }
      }
      const draft = !localProject && !requestedProject ? await readStudioDraft<BeadProjectData>('beads') : null
      const data = localProject?.data && isBeadProjectData(localProject.data) ? localProject.data : draft && isBeadProjectData(draft) ? draft : null
      if (cancelled) return
      if (data) {
        setSettings({ ...defaultSettings, ...data.settings })
        setPattern(data.pattern)
        patternRef.current = data.pattern
        const completedIndexes = Array.isArray(data.completed)
          ? data.completed.filter((index) => Number.isInteger(index) && index >= 0 && index < data.pattern.cells.length)
          : []
        setCompleted(new Set(completedIndexes))
        setHistory([])
        setRedoStack([])
        setSelection(null)
        if (localProject) {
          setProjectId(localProject.id)
          setTitle(localProject.title)
          setCreatedAt(localProject.createdAt)
          setVisibility(localProject.visibility)
          setReviewStatus(localProject.reviewStatus)
          setSaveStatus('saved')
        }
      } else if (requestedProject) {
        setError('这个创作项目不存在、已损坏，或你没有访问权限。')
      }
      if (requestedMode === 'craft') setCraftMode(true)
      setLoaded(true)
      recordStudioEvent('beads', localProject ? 'project_open' : 'tool_open')
    }
    void loadProject()
    return () => { cancelled = true }
  }, [isAuthenticated, requestedMode, requestedProject])

  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => {
      const data: BeadProjectData = { version: 1, tool: 'beads', settings, pattern, completed: [...completed] }
      void writeStudioDraft('beads', data)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [completed, loaded, pattern, settings])

  const persistPattern = useCallback((cells: number[], label: string, withHistory = true, replacementGrid?: BeadPatternGrid) => {
    const current = patternRef.current
    const next = replacementGrid ? { ...replacementGrid, palette: [...replacementGrid.palette], cells: [...cells] } : { ...current, cells: [...cells] }
    const structuralChange = current.width !== next.width || current.height !== next.height || current.palette !== next.palette
    if (!structuralChange && sameCells(current.cells, cells)) return false
    const patches = diffCells(current.cells, next.cells)
    if (withHistory) {
      const entry: HistoryEntry = {
        patches,
        label,
        ...(structuralChange ? { beforeGrid: snapshotGrid(current), afterGrid: snapshotGrid(next) } : {}),
      }
      setHistory((items) => [...items, entry].slice(-100))
    }
    setRedoStack([])
    patternRef.current = next
    setPattern(next)
    setSaveStatus('unsaved')
    return true
  }, [])

  function beginDrawGesture() {
    const cells = [...patternRef.current.cells]
    gestureCellsRef.current = cells
    pointerRef.current = { kind: 'draw', before: cells, changed: false, lastCell: -1, lastX: 0, lastY: 0 }
  }

  function applyGestureCell(index: number) {
    if (index < 0 || pointerRef.current.kind !== 'draw') return
    if (pointerRef.current.lastCell === index) return
    const current = patternRef.current
    const cells = gestureCellsRef.current
    if (!cells) return
    const nextValue = editorTool === 'eraser' ? EMPTY_CELL : currentColorIndex
    if (cells[index] === nextValue) {
      pointerRef.current.lastCell = index
      return
    }
    cells[index] = nextValue
    pointerRef.current.changed = true
    pointerRef.current.lastCell = index
    const next = { ...current, cells }
    patternRef.current = next
    setPattern(next)
    setSaveStatus('unsaved')
  }

  function finishGesture() {
    const gesture = pointerRef.current
    if (gesture.kind === 'draw' && gesture.changed && gesture.before) {
      const patches = diffCells(gesture.before, patternRef.current.cells)
      if (patches.length) {
        setHistory((items) => [...items, { patches, label: editorTool === 'eraser' ? '擦除图纸' : '绘制图纸' }].slice(-100))
        setRedoStack([])
      }
    }
    gestureCellsRef.current = null
    craftCompletedRef.current = null
    pointerRef.current = { kind: null, before: null, changed: false, lastCell: -1, lastX: 0, lastY: 0 }
  }

  function applyCraftCell(index: number, completedValue: boolean) {
    if (index < 0 || patternRef.current.cells[index] === EMPTY_CELL || (craftColor !== null && patternRef.current.cells[index] !== craftColor)) return
    if (pointerRef.current.lastCell === index) return
    const next = craftCompletedRef.current
    if (!next) return
    if (completedValue) next.add(index)
    else next.delete(index)
    pointerRef.current.lastCell = index
    setCompleted(new Set(next))
    setSaveStatus('unsaved')
  }

  function applyCraftSelection(nextSelection: Selection | null) {
    if (!nextSelection) return
    const next = craftCompletedRef.current || new Set(completed)
    const xStart = Math.max(0, Math.min(nextSelection.xStart, nextSelection.xEnd))
    const xEnd = Math.min(patternRef.current.width - 1, Math.max(nextSelection.xStart, nextSelection.xEnd))
    const yStart = Math.max(0, Math.min(nextSelection.yStart, nextSelection.yEnd))
    const yEnd = Math.min(patternRef.current.height - 1, Math.max(nextSelection.yStart, nextSelection.yEnd))
    for (let y = yStart; y <= yEnd; y += 1) {
      for (let x = xStart; x <= xEnd; x += 1) {
        const index = y * patternRef.current.width + x
        if (patternRef.current.cells[index] === EMPTY_CELL || (craftColor !== null && patternRef.current.cells[index] !== craftColor)) continue
        if (craftActionRef.current) next.add(index)
        else next.delete(index)
      }
    }
    craftCompletedRef.current = next
    setCompleted(new Set(next))
    setSaveStatus('unsaved')
  }

  function selectionFromIndexes(startIndex: number, endIndex: number): Selection | null {
    if (startIndex < 0 || endIndex < 0) return null
    const width = patternRef.current.width
    return {
      xStart: startIndex % width,
      yStart: Math.floor(startIndex / width),
      xEnd: endIndex % width,
      yEnd: Math.floor(endIndex / width),
    }
  }

  function cellFromPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return -1
    const x = Math.floor((event.clientX - rect.left) / rect.width * patternRef.current.width)
    const y = Math.floor((event.clientY - rect.top) / rect.height * patternRef.current.height)
    if (x < 0 || y < 0 || x >= patternRef.current.width || y >= patternRef.current.height) return -1
    return y * patternRef.current.width + x
  }

  function editCell(index: number) {
    if (index < 0) return
    const current = patternRef.current
    if (editorTool === 'eyedropper') {
      const picked = current.cells[index]
      if (picked !== EMPTY_CELL) {
        setCurrentColorIndex(picked)
        setEditorTool('brush')
        showToast(`已取色 ${current.palette[picked]?.code || ''}`)
      } else showToast('这里是空白格，没有可吸取的颜色。')
      return
    }
    if (editorTool === 'fill') {
      const next = floodFill(current.cells, current.width, current.height, index, currentColorIndex)
      if (persistPattern(next, '填充区域')) showToast('已填充相连区域。')
    }
  }

  function onCanvasPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const index = cellFromPointer(event)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (craftMode) {
      if (editorTool === 'pan') {
        event.currentTarget.setPointerCapture(event.pointerId)
        pointerRef.current = { kind: 'pan', before: null, changed: false, lastCell: -1, lastX: event.clientX, lastY: event.clientY }
        return
      }
      if (index < 0 || (editorTool !== 'select' && (patternRef.current.cells[index] === EMPTY_CELL || (craftColor !== null && patternRef.current.cells[index] !== craftColor)))) {
        pointersRef.current.delete(event.pointerId)
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      craftCompletedRef.current = new Set(completed)
      craftActionRef.current = patternRef.current.cells[index] !== EMPTY_CELL && (craftColor === null || patternRef.current.cells[index] === craftColor) ? !craftCompletedRef.current.has(index) : true
      if (editorTool === 'select') {
        selectionStartRef.current = index
        setSelection(selectionFromIndexes(index, index))
        pointerRef.current = { kind: 'select', before: null, changed: false, lastCell: index, lastX: event.clientX, lastY: event.clientY }
      } else {
        pointerRef.current = { kind: 'craft', before: null, changed: false, lastCell: -1, lastX: event.clientX, lastY: event.clientY }
        applyCraftCell(index, craftActionRef.current)
      }
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointersRef.current.size >= 2) {
      finishGesture()
      selectionStartRef.current = null
      const points = [...pointersRef.current.values()]
      pinchRef.current = { distance: Math.max(1, pointerDistance(points[0], points[1])), center: pointerCenter(points[0], points[1]), zoom, pan }
      return
    }
    if (editorTool === 'pan') {
      pointerRef.current = { kind: 'pan', before: null, changed: false, lastCell: -1, lastX: event.clientX, lastY: event.clientY }
      return
    }
    if (editorTool === 'select') {
      selectionStartRef.current = index
      setSelection(selectionFromIndexes(index, index))
      pointerRef.current = { kind: 'select', before: null, changed: false, lastCell: index, lastX: event.clientX, lastY: event.clientY }
      return
    }
    beginDrawGesture()
    if (editorTool === 'brush' || editorTool === 'eraser') applyGestureCell(index)
    else editCell(index)
  }

  function onCanvasPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size >= 2) {
      const points = [...pointersRef.current.values()]
      const pinch = pinchRef.current
      if (pinch) {
        const distanceRatio = pointerDistance(points[0], points[1]) / pinch.distance
        const center = pointerCenter(points[0], points[1])
        setZoom(Math.max(.5, Math.min(3, pinch.zoom * distanceRatio)))
        setPan({ x: pinch.pan.x + center.x - pinch.center.x, y: pinch.pan.y + center.y - pinch.center.y })
      }
      return
    }
    const pointer = pointerRef.current
    if (pointer.kind === 'pan') {
      setPan((current) => ({ x: current.x + event.clientX - pointer.lastX, y: current.y + event.clientY - pointer.lastY }))
      pointer.lastX = event.clientX
      pointer.lastY = event.clientY
      return
    }
    if (pointer.kind === 'craft') {
      applyCraftCell(cellFromPointer(event), craftActionRef.current)
      return
    }
    if (pointer.kind === 'select' && selectionStartRef.current !== null) {
      const index = cellFromPointer(event)
      if (index >= 0) setSelection(selectionFromIndexes(selectionStartRef.current, index))
      return
    }
    if (pointer.kind === 'draw' && (editorTool === 'brush' || editorTool === 'eraser')) applyGestureCell(cellFromPointer(event))
  }

  function onCanvasPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const pointer = pointerRef.current
    if (pointer.kind === 'select' && craftMode && selectionStartRef.current !== null) {
      const finalSelection = selectionFromIndexes(selectionStartRef.current, cellFromPointer(event))
      if (finalSelection) {
        setSelection(finalSelection)
        applyCraftSelection(finalSelection)
      }
    }
    pointersRef.current.delete(event.pointerId)
    if (pinchRef.current && pointersRef.current.size < 2) pinchRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* pointer may already be released */ }
    if (pointer.kind === 'select') selectionStartRef.current = null
    finishGesture()
  }

  function undo() {
    setHistory((items) => {
      const entry = items.at(-1)
      if (!entry) return items
      const current = patternRef.current
      setRedoStack((redo) => [...redo, entry].slice(-100))
      const next = entry.beforeGrid
        ? { ...entry.beforeGrid, palette: [...entry.beforeGrid.palette], cells: [...entry.beforeGrid.cells] }
        : (() => {
          const cells = [...current.cells]
          entry.patches.forEach((patch) => { cells[patch.index] = patch.before })
          return { ...current, cells }
        })()
      patternRef.current = next
      setPattern(next)
      setSaveStatus('unsaved')
      return items.slice(0, -1)
    })
  }

  function redo() {
    setRedoStack((items) => {
      const entry = items.at(-1)
      if (!entry) return items
      const current = patternRef.current
      setHistory((historyItems) => [...historyItems, entry].slice(-100))
      const next = entry.afterGrid
        ? { ...entry.afterGrid, palette: [...entry.afterGrid.palette], cells: [...entry.afterGrid.cells] }
        : (() => {
          const cells = [...current.cells]
          entry.patches.forEach((patch) => { cells[patch.index] = patch.after })
          return { ...current, cells }
        })()
      patternRef.current = next
      setPattern(next)
      setSaveStatus('unsaved')
      return items.slice(0, -1)
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    renderPatternToCanvas(canvas, pattern, {
      beadMode: viewMode === 'bead',
      displayGrid,
      displayCodes,
      displayCoordinates,
      displayBoardLines,
      transparentBackground: false,
      completed,
      activeColorIndex: craftMode ? craftColor : null,
      selection,
    })
  }, [completed, craftColor, craftMode, displayBoardLines, displayCodes, displayCoordinates, displayGrid, pattern, selection, viewMode])

  function updateSettings(patch: Partial<BeadSettings>) {
    setSettings((current) => ({ ...current, ...patch }))
    setSaveStatus('unsaved')
  }

  function setDimension(key: 'width' | 'height', rawValue: number) {
    const value = Math.max(1, Math.min(200, Math.round(rawValue || 1)))
    const current = settings
    if (!current.lockRatio) return updateSettings({ [key]: value })
    const ratio = current.width / Math.max(1, current.height)
    if (key === 'width') updateSettings({ width: value, height: Math.max(1, Math.min(200, Math.round(value / ratio))) })
    else updateSettings({ height: value, width: Math.max(1, Math.min(200, Math.round(value * ratio))) })
  }

  function changeBrand(brand: BeadSettings['brand']) {
    const series = getSeriesForBrand(brand)[0] || 'Standard'
    const palette = getPalette(brand, series)
    updateSettings({ brand, series })
    const next = { ...patternRef.current, palette }
    patternRef.current = next
    setPattern(next)
  }

  function resetCropSettings() {
    updateSettings({ cropZoom: 1, cropX: 0, cropY: 0, rotation: 0 })
  }

  function resetImageAdjustments() {
    updateSettings({ brightness: 0, contrast: 0, saturation: 0 })
  }

  function clearSourceImage() {
    if (sourceObjectUrlRef.current) URL.revokeObjectURL(sourceObjectUrlRef.current)
    sourceObjectUrlRef.current = null
    sourceImageRef.current = null
    setSourceImageUrl(null)
    setSourceImageName('')
    setError('')
  }

  function handleFile(file: File | null) {
    if (!file) return
    const accepted = /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)
    if (!accepted) return setError('暂不支持这个格式，请选择 JPG、PNG 或 WebP 图片。')
    if (file.size > 20 * 1024 * 1024) return setError('图片不能超过 20MB，请先压缩后再试。')
    setError('')
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth > 12000 || image.naturalHeight > 12000) {
        URL.revokeObjectURL(url)
        setError('图片像素尺寸过大，请使用 12000 × 12000 以内的图片。')
        return
      }
      if (sourceObjectUrlRef.current) URL.revokeObjectURL(sourceObjectUrlRef.current)
      sourceObjectUrlRef.current = url
      sourceImageRef.current = image
      setSourceImageUrl(url)
      setSourceImageName(file.name)
      showToast('图片已在浏览器本地读取，可以调整后生成。')
    }
    image.onerror = () => { URL.revokeObjectURL(url); setError('图片解析失败，请换一张图片再试。') }
    image.src = url
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    handleFile(event.target.files?.[0] || null)
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragActive(false)
    handleFile(event.dataTransfer.files?.[0] || null)
  }

  function generate() {
    const source = sourceImageRef.current
    if (!source) {
      setError('请先上传一张图片，再生成拼豆图纸。')
      setActivePanel('settings')
      return
    }
    setError('')
    setProcessing(true)
    setActivePanel('preview')
    window.setTimeout(async () => {
      try {
        const next = await generatePatternFromImageInWorker(source, settings, getPalette(settings.brand, settings.series))
        if (persistPattern(next.cells, '生成新图纸', true, next)) {
          setCompleted(new Set())
          recordStudioEvent('beads', 'project_create')
          showToast('图纸已生成，可以继续编辑。')
        }
      } catch {
        setError('图纸生成失败，请降低尺寸或换一张图片再试。')
      } finally {
        setProcessing(false)
      }
    }, 80)
  }

  const persistProject = useCallback(async (silent = false) => {
    const now = new Date().toISOString()
    const localId = projectId || createStudioId()
    const data: BeadProjectData = { version: 1, tool: 'beads', settings, pattern: patternRef.current, completed: [...completed] }
    const summary = calculateMaterialList(patternRef.current, packSize)
    const localProject: StudioLocalProject = {
      id: localId,
      toolSlug: 'beads',
      title: title.trim() || '未命名图纸',
      description: '拼豆图纸作品',
      version: 1,
      data,
      thumbnailUrl: renderPatternToDataUrl(patternRef.current, { displayGrid: true, displayCodes: false, displayBoardLines: true }),
      visibility,
      reviewStatus,
      createdAt: createdAt || now,
      updatedAt: now,
      lastOpenedAt: now,
      metadata: { width: summary.width, height: summary.height, totalBeads: summary.totalBeads, colorCount: summary.colorCount },
      supportedExportFormats: beadsTool.supportedExportFormats,
    }
    setSaveStatus('saving')
    try {
      await saveLocalStudioProject(localProject)
      let resolvedId = localId
      let remoteProject: Partial<StudioLocalProject> | null = null
      if (isAuthenticated) {
        const response = await fetch('/api/studio/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: projectId && !projectId.startsWith('local-') ? projectId : undefined,
            toolSlug: 'beads',
            title: localProject.title,
            description: localProject.description,
            version: 1,
            data,
            thumbnailUrl: localProject.thumbnailUrl,
          }),
        })
        if (!response.ok) throw new Error('cloud save failed')
        const body = await response.json() as { project?: Partial<StudioLocalProject> }
        remoteProject = body.project || null
        if (remoteProject?.id && remoteProject.id !== localId) {
          await deleteLocalStudioProject(localId)
          resolvedId = remoteProject.id
          await saveLocalStudioProject({ ...localProject, ...remoteProject, id: resolvedId, thumbnailUrl: remoteProject.thumbnailUrl || localProject.thumbnailUrl })
        }
      }
      setProjectId(resolvedId)
      setCreatedAt(localProject.createdAt)
      clearStudioDraft('beads')
      setSaveStatus('saved')
      recordStudioEvent('beads', 'project_save')
      if (!silent) showToast(isAuthenticated ? '作品已保存到我的创作。' : '作品已保存到此设备；登录后可跨设备同步。')
    } catch {
      setSaveStatus('failed')
      if (!silent) showToast(isAuthenticated ? '已保存到此设备，但云端同步失败。' : '已保存到此设备。')
    }
  }, [completed, createdAt, isAuthenticated, packSize, projectId, reviewStatus, settings, showToast, title, visibility])

  useEffect(() => {
    if (!loaded || !projectId || saveStatus !== 'unsaved') return
    const timer = window.setTimeout(() => { void persistProject(true) }, 6500)
    return () => window.clearTimeout(timer)
  }, [loaded, pattern, persistProject, projectId, saveStatus, settings, title])

  function exportFile(format: StudioExportFormat) {
    const name = (title.trim() || '拼豆图纸').replace(/[\\/:*?"<>|]/g, '_')
    try {
      if (format === 'PNG') {
        downloadUrl(renderPatternToDataUrl(patternRef.current, { beadMode: viewMode === 'bead', displayGrid, displayCodes, displayCoordinates, displayBoardLines, transparentBackground }), `${name}.png`)
      } else if (format === 'PDF') {
        downloadBlob(createBeadPatternPdf(patternRef.current, title), `${name}.pdf`)
      } else {
        showToast(`${format} 导出将在对应工具上线后提供。`)
        return
      }
      recordStudioEvent('beads', 'project_export')
      showToast(`${format} 文件已开始下载。`)
    } catch {
      showToast('导出失败，请稍后再试。')
    }
  }

  async function updateLocalPublicationStatus(nextVisibility: StudioVisibility, nextReviewStatus: StudioReviewStatus) {
    if (!projectId) return
    const localProject = await getLocalStudioProject(projectId)
    if (localProject) await saveLocalStudioProject({ ...localProject, visibility: nextVisibility, reviewStatus: nextReviewStatus, updatedAt: new Date().toISOString() })
  }

  async function share() {
    if (!isAuthenticated) {
      showToast('登录后保存并发布作品，才能生成公开分享链接。')
      return
    }
    if (!projectId || projectId.startsWith('local-')) {
      showToast('请先保存作品，再申请发布。私密项目不会直接生成公开链接。')
      return
    }
    if ((visibility === 'PUBLIC' && reviewStatus === 'APPROVED') || visibility === 'UNLISTED') {
      try {
        const result = await shareContent({ title: title.trim() || '拼豆图纸', text: '来自贝多芬与我的拼豆图纸', url: `${window.location.origin}/studio/project/${encodeURIComponent(projectId)}` })
        showToast(result === 'shared' ? '已打开分享面板。' : '作品链接已复制。')
      } catch {
        showToast('分享已取消。')
      }
      return
    }
    if (reviewStatus === 'PENDING') {
      showToast('作品正在等待公开审核，通过后即可生成分享链接。')
      return
    }
    try {
      const response = await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}/publish`, { method: 'POST' })
      const body = await response.json() as { message?: string; visibility?: StudioVisibility; reviewStatus?: StudioReviewStatus }
      if (!response.ok) throw new Error(body.message || 'publish failed')
      const nextVisibility = body.visibility || 'PUBLIC'
      const nextReviewStatus = body.reviewStatus || 'PENDING'
      setVisibility(nextVisibility)
      setReviewStatus(nextReviewStatus)
      await updateLocalPublicationStatus(nextVisibility, nextReviewStatus)
      recordStudioEvent('beads', 'project_publish')
      showToast(body.message || '已提交公开审核。')
    } catch (publishError) {
      showToast(publishError instanceof Error ? publishError.message : '提交公开审核失败，请稍后重试。')
    }
  }

  function replaceSelectedColor() {
    if (currentColorIndex === replaceWith) return
    const amount = patternRef.current.cells.filter((cell) => cell === currentColorIndex).length
    if (!amount) return showToast('当前颜色没有出现在图纸中。')
    if (persistPattern(replaceColor(patternRef.current.cells, currentColorIndex, replaceWith), '全局换色')) showToast(`已替换 ${amount} 颗拼豆。`)
  }

  function updateSelection(value: number) {
    if (!selection) return
    const xStart = Math.max(0, Math.min(selection.xStart, selection.xEnd))
    const xEnd = Math.min(patternRef.current.width - 1, Math.max(selection.xStart, selection.xEnd))
    const yStart = Math.max(0, Math.min(selection.yStart, selection.yEnd))
    const yEnd = Math.min(patternRef.current.height - 1, Math.max(selection.yStart, selection.yEnd))
    const cells = [...patternRef.current.cells]
    for (let y = yStart; y <= yEnd; y += 1) {
      for (let x = xStart; x <= xEnd; x += 1) cells[y * patternRef.current.width + x] = value
    }
    if (persistPattern(cells, value === EMPTY_CELL ? '清除选区' : '填充选区')) showToast(value === EMPTY_CELL ? '已清除选区。' : '已用当前颜色填充选区。')
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await previewStageRef.current?.requestFullscreen()
    } catch {
      showToast('当前浏览器不支持全屏预览。')
    }
  }

  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }) }

  const mobilePanelClass = (panel: MobilePanel) => activePanel === panel ? '' : styles.mobilePanelHidden
  const palette = pattern.palette
  return <StudioToolShell tool={beadsTool} title={title} saveStatus={saveStatus} onSave={() => void persistProject(false)} onShare={share} onExport={exportFile} openExportOnMount={requestedExport}>
    <div className={styles.beadsPage}>
      <div className={styles.mobilePanelTabs} role="tablist" aria-label="拼豆工具面板">
        {([['settings', '设置'], ['preview', '预览'], ['materials', '材料']] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={activePanel === key} className={`${styles.mobilePanelTab} ${activePanel === key ? styles.mobilePanelTabActive : ''}`} onClick={() => setActivePanel(key)}>{label}</button>)}
      </div>
      <div className={styles.beadsWorkspace}>
        <aside className={`${styles.beadsPanel} ${mobilePanelClass('settings')}`}>
          <section className={`${styles.panelSection} ${styles.panelSectionFirst}`}>
            <div className={styles.panelHeader}><div><span className={styles.panelStep}>01 / START</span><h2 className={styles.panelTitle}>上传图片</h2></div><button type="button" className={styles.panelToggle} onClick={clearSourceImage}>清空</button></div>
            {sourceImageUrl ? <div className={styles.sourcePreview}><img src={sourceImageUrl} alt="已选择的本地图片预览" className={styles.sourcePreviewImage} style={{ transform: `translate(${settings.cropX / 2}%, ${settings.cropY / 2}%) scale(${settings.cropZoom}) rotate(${settings.rotation}deg)` }} /><span className={styles.sourcePreviewOverlay}>{sourceImageName || '本地图片'}</span></div> : null}
            <label className={`${styles.uploadDropzone} ${dragActive ? styles.uploadDropzoneActive : ''}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={onDrop}>
              <input className={styles.uploadInput} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={onFileChange} aria-label="选择图片" />
              <span className={styles.uploadIcon}><UiIcon name="camera" /></span><span className={styles.uploadTitle}>{sourceImageUrl ? '更换图片' : '点击或拖入图片'}</span><span className={styles.uploadHint}>JPG / PNG / WebP · 最大 20MB<br />原图只在本地处理</span>
            </label>
            {sourceImageUrl ? <div className={styles.fieldGroup}><label className={styles.formLabel}>缩放 <span className={styles.rangeValue}>{settings.cropZoom.toFixed(2)}×</span></label><input className={styles.range} type="range" min="1" max="2.5" step="0.05" value={settings.cropZoom} onChange={(event) => updateSettings({ cropZoom: Number(event.target.value) })} /><label className={styles.formLabel}>水平 / 垂直 <span className={styles.rangeValue}>{settings.cropX} / {settings.cropY}</span></label><input className={styles.range} type="range" min="-100" max="100" value={settings.cropX} onChange={(event) => updateSettings({ cropX: Number(event.target.value) })} /><input className={styles.range} type="range" min="-100" max="100" value={settings.cropY} onChange={(event) => updateSettings({ cropY: Number(event.target.value) })} /><label className={styles.formLabel}>旋转 <span className={styles.rangeValue}>{settings.rotation}°</span></label><input className={styles.range} type="range" min="-180" max="180" value={settings.rotation} onChange={(event) => updateSettings({ rotation: Number(event.target.value) })} /><button type="button" className={styles.panelToggle} onClick={resetCropSettings}>重置裁切</button></div> : null}
            <div className={styles.fieldGroup}><label className={styles.formLabel}>裁切比例</label><div className={styles.ratioGrid}>{(['free', '1:1', '4:3', '3:4', '16:9', '9:16'] as const).map((ratio) => <button key={ratio} type="button" className={`${styles.ratioButton} ${settings.cropRatio === ratio ? styles.ratioActive : ''}`} onClick={() => updateSettings({ cropRatio: ratio })}>{ratio === 'free' ? '自由' : ratio}</button>)}</div></div>
          </section>
          <section className={styles.panelSection}>
            <div className={styles.panelHeader}><div><span className={styles.panelStep}>02 / SETUP</span><h2 className={styles.panelTitle}>图纸设置</h2></div></div>
            <div className={styles.fieldGroup}><label className={styles.formLabel}>作品名称</label><input className={styles.numberInput} value={title} onChange={(event) => { setTitle(event.target.value); setSaveStatus('unsaved') }} maxLength={80} /></div>
            <div className={styles.fieldGroup}><label className={styles.formLabel}>图片类型</label><div className={styles.segmented}><button type="button" className={`${styles.segment} ${settings.imageType === 'cartoon' ? styles.segmentActive : ''}`} onClick={() => updateSettings({ imageType: 'cartoon' })}>卡通 / 像素</button><button type="button" className={`${styles.segment} ${settings.imageType === 'photo' ? styles.segmentActive : ''}`} onClick={() => updateSettings({ imageType: 'photo' })}>照片</button></div></div>
            <div className={styles.fieldGroup}><label className={styles.formLabel}>尺寸（颗） <span className={styles.formHint}>{settings.lockRatio ? '比例已锁定' : '自由尺寸'}</span></label><div className={styles.sizeRow}><input className={styles.numberInput} type="number" min="1" max="200" value={settings.width} onChange={(event) => setDimension('width', Number(event.target.value))} aria-label="图纸宽度" /><input className={styles.numberInput} type="number" min="1" max="200" value={settings.height} onChange={(event) => setDimension('height', Number(event.target.value))} aria-label="图纸高度" /></div><div className={styles.presetRow}>{([[29, 29], [58, 29], [58, 58], [87, 58], [87, 87]] as const).map(([width, height]) => <button key={`${width}x${height}`} type="button" className={`${styles.preset} ${settings.width === width && settings.height === height ? styles.presetActive : ''}`} onClick={() => updateSettings({ width, height })}>{width}×{height}</button>)}</div><label className={styles.checkboxRow} style={{ marginTop: 10 }}><input className={styles.checkbox} type="checkbox" checked={settings.lockRatio} onChange={(event) => updateSettings({ lockRatio: event.target.checked })} />锁定宽高比</label></div>
            <div className={styles.fieldGroup}><label className={styles.formLabel}>品牌 / 色板</label><div className={styles.sizeRow}><select className={styles.select} value={settings.brand} onChange={(event) => changeBrand(event.target.value as BeadSettings['brand'])}>{supportedBeadBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select><select className={styles.select} value={settings.series} onChange={(event) => { const series = event.target.value; updateSettings({ series }); const next = { ...patternRef.current, palette: getPalette(settings.brand, series) }; patternRef.current = next; setPattern(next) }}>{getSeriesForBrand(settings.brand).map((series) => <option key={series} value={series}>{series}</option>)}</select></div></div>
            <div className={styles.fieldGroup}><label className={styles.formLabel}>颜色匹配</label><div className={styles.segmented}><button type="button" className={`${styles.segment} ${settings.matchingMode === 'fast' ? styles.segmentActive : ''}`} onClick={() => updateSettings({ matchingMode: 'fast' })}>快速</button><button type="button" className={`${styles.segment} ${settings.matchingMode === 'balanced' ? styles.segmentActive : ''}`} onClick={() => updateSettings({ matchingMode: 'balanced' })}>均衡</button><button type="button" className={`${styles.segment} ${settings.matchingMode === 'precise' ? styles.segmentActive : ''}`} onClick={() => updateSettings({ matchingMode: 'precise' })}>精确</button></div></div>
            <details className={styles.advancedDetails}><summary className={styles.advancedSummary}>更多图像调整</summary><div className={styles.fieldGroup}><label className={styles.formLabel}>最大颜色数 <span className={styles.formHint}>量化后不超过此数</span></label><select className={styles.select} value={settings.maxColors} onChange={(event) => updateSettings({ maxColors: Number(event.target.value) as BeadSettings['maxColors'] })}>{[8, 12, 16, 24, 32, 0].map((value) => <option key={value} value={value}>{value || '不限'}</option>)}</select></div><div className={styles.fieldGroup}><label className={styles.formLabel}>亮度 <span className={styles.rangeValue}>{settings.brightness}</span></label><input className={styles.range} type="range" min="-100" max="100" value={settings.brightness} onChange={(event) => updateSettings({ brightness: Number(event.target.value) })} /></div><div className={styles.fieldGroup}><label className={styles.formLabel}>对比度 <span className={styles.rangeValue}>{settings.contrast}</span></label><input className={styles.range} type="range" min="-100" max="100" value={settings.contrast} onChange={(event) => updateSettings({ contrast: Number(event.target.value) })} /></div><div className={styles.fieldGroup}><label className={styles.formLabel}>饱和度 <span className={styles.rangeValue}>{settings.saturation}</span></label><input className={styles.range} type="range" min="-100" max="100" value={settings.saturation} onChange={(event) => updateSettings({ saturation: Number(event.target.value) })} /><button type="button" className={styles.panelToggle} onClick={resetImageAdjustments}>重置亮度 / 对比度 / 饱和度</button></div><label className={styles.checkboxRow} style={{ marginTop: 12 }}><input className={styles.checkbox} type="checkbox" checked={settings.whiteAsEmpty} onChange={(event) => updateSettings({ whiteAsEmpty: event.target.checked })} />接近白色的区域视为空白</label><label className={styles.checkboxRow} style={{ marginTop: 9 }}><input className={styles.checkbox} type="checkbox" checked={settings.removeBackground} onChange={(event) => updateSettings({ removeBackground: event.target.checked })} />吸管去背景（使用左上角颜色）</label><div className={styles.fieldGroup}><label className={styles.formLabel}>抖动</label><select className={styles.select} value={settings.dithering} onChange={(event) => updateSettings({ dithering: event.target.value as BeadSettings['dithering'] })}><option value="none">关闭</option><option value="floyd-steinberg">Floyd–Steinberg</option></select></div><div className={styles.fieldGroup}><label className={styles.formLabel}>清理零碎颜色</label><select className={styles.select} value={settings.cleanupThreshold} onChange={(event) => updateSettings({ cleanupThreshold: Number(event.target.value) as BeadSettings['cleanupThreshold'] })}><option value="0">关闭</option><option value="2">≤ 2 颗</option><option value="3">≤ 3 颗</option><option value="5">≤ 5 颗</option><option value="10">≤ 10 颗</option></select></div></details>
            <button type="button" className={styles.generateButton} onClick={generate} disabled={processing}><UiIcon name="activity" />{processing ? '正在生成…' : '生成拼豆图纸'}</button>
            <p className={styles.settingsSubtle}>生成和编辑都在浏览器本地完成，原图不会自动上传到服务器。</p>
          </section>
          <section className={styles.panelSection}>
            <div className={styles.panelHeader}><div><span className={styles.panelStep}>03 / EDIT</span><h2 className={styles.panelTitle}>颜色面板</h2></div><span className={styles.formHint}>{palette.length} 色</span></div>
            <div className={styles.toolPalette}>{palette.map((color, index) => <button key={`${color.code}-${index}`} type="button" className={`${styles.paletteColor} ${currentColorIndex === index ? styles.paletteColorActive : ''}`} onClick={() => { setCurrentColorIndex(index); if (craftMode) setCraftColor(index) }} aria-label={`选择${color.code}${color.name}`}><i className={styles.paletteColorSwatch} style={{ background: color.hex }} /><span className={styles.paletteColorText}><b className={styles.paletteColorCode}>{color.code}</b><small className={styles.paletteColorCount}>{materials.materials.find((item) => item.index === index)?.quantity || 0}</small></span></button>)}</div>
          </section>
        </aside>

          <section className={styles.beadsPreviewPanel}>
            <header className={styles.previewHeader}><div><strong className={styles.previewTitle}>图纸预览</strong><p className={styles.previewMeta}>{pattern.width} × {pattern.height} 颗 · {settings.brand} {settings.series}{craftMode && activeMaterial ? ` · 正在拼 ${activeMaterial.code}` : ''}</p></div><div className={styles.viewToggle}><button type="button" className={`${styles.viewToggleButton} ${viewMode === 'grid' ? styles.viewToggleActive : ''}`} onClick={() => setViewMode('grid')}>图纸</button><button type="button" className={`${styles.viewToggleButton} ${viewMode === 'bead' ? styles.viewToggleActive : ''}`} onClick={() => setViewMode('bead')}>圆豆</button></div></header>
          <div ref={previewStageRef} className={`${styles.previewStage} ${isFullscreen ? styles.previewStageFullscreen : ''}`} onWheel={(event) => { event.preventDefault(); setZoom((current) => Math.max(.5, Math.min(3, current - event.deltaY * .001))) }}><div className={styles.canvasViewport}><div className={styles.canvasFrame} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><canvas ref={canvasRef} className={styles.previewCanvas} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerUp} aria-label="拼豆图纸编辑画布" /></div></div>{processing ? <div className={styles.processing}><i className={styles.processingMark} /><span>正在分析图片并匹配色板…</span></div> : null}</div>
          <div className={styles.previewFooter}><div className={styles.previewTools}><button type="button" className={`${styles.iconButton} ${editorTool === 'brush' ? styles.iconButtonActive : ''}`} onClick={() => setEditorTool('brush')} aria-label="画笔">✎</button><button type="button" className={`${styles.iconButton} ${editorTool === 'eraser' ? styles.iconButtonActive : ''}`} onClick={() => setEditorTool('eraser')} aria-label="橡皮">⌫</button><button type="button" className={`${styles.iconButton} ${editorTool === 'eyedropper' ? styles.iconButtonActive : ''}`} onClick={() => setEditorTool('eyedropper')} aria-label="吸管">◉</button><button type="button" className={`${styles.iconButton} ${editorTool === 'fill' ? styles.iconButtonActive : ''}`} onClick={() => setEditorTool('fill')} aria-label="油漆桶">▧</button><button type="button" className={`${styles.iconButton} ${editorTool === 'select' ? styles.iconButtonActive : ''}`} onClick={() => setEditorTool('select')} aria-label="框选">▣</button><button type="button" className={`${styles.iconButton} ${editorTool === 'pan' ? styles.iconButtonActive : ''}`} onClick={() => setEditorTool('pan')} aria-label="移动画布"><UiIcon name="grid" /></button><button type="button" className={styles.iconButton} onClick={undo} disabled={!history.length} aria-label="撤销">↶</button><button type="button" className={styles.iconButton} onClick={redo} disabled={!redoStack.length} aria-label="重做">↷</button><button type="button" className={styles.iconButton} onClick={() => setZoom((current) => Math.min(3, current + .2))} aria-label="放大">＋</button><button type="button" className={styles.iconButton} onClick={() => setZoom((current) => Math.max(.5, current - .2))} aria-label="缩小">－</button><button type="button" className={styles.iconButton} onClick={resetView} aria-label="适应画面">⌂</button><button type="button" className={styles.iconButton} onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? '退出全屏' : '全屏预览'}>{isFullscreen ? '×' : '⛶'}</button></div><div className={styles.previewLegend}><label className={styles.legendItem}><input className={styles.checkbox} type="checkbox" checked={displayGrid} onChange={(event) => setDisplayGrid(event.target.checked)} />网格</label><label className={styles.legendItem}><input className={styles.checkbox} type="checkbox" checked={displayCodes} onChange={(event) => setDisplayCodes(event.target.checked)} />色号</label><label className={styles.legendItem}><input className={styles.checkbox} type="checkbox" checked={displayCoordinates} onChange={(event) => setDisplayCoordinates(event.target.checked)} />坐标</label></div></div>
          {selection ? <div className={styles.selectionBar}><span>已选 {Math.abs(selection.xEnd - selection.xStart) + 1} × {Math.abs(selection.yEnd - selection.yStart) + 1} 格</span><button type="button" className={styles.selectionAction} onClick={() => updateSelection(currentColorIndex)}>填充选区</button><button type="button" className={styles.selectionAction} onClick={() => updateSelection(EMPTY_CELL)}>清除选区</button><button type="button" className={styles.selectionAction} onClick={() => setSelection(null)}>取消</button></div> : null}
        </section>

        <aside className={`${styles.beadsStatsPanel} ${mobilePanelClass('materials')}`}>
          <div className={styles.statsGrid}><div className={styles.statCard}><span className={styles.statLabel}>总拼豆</span><strong className={styles.statValue}>{materials.totalBeads.toLocaleString()}</strong><small className={styles.statNote}>非空格子</small></div><div className={styles.statCard}><span className={styles.statLabel}>空白格</span><strong className={styles.statValue}>{materials.emptyCells.toLocaleString()}</strong><small className={styles.statNote}>无需放豆</small></div><div className={styles.statCard}><span className={styles.statLabel}>颜色</span><strong className={styles.statValue}>{materials.colorCount}</strong><small className={styles.statNote}>当前色板</small></div><div className={styles.statCard}><span className={styles.statLabel}>底板</span><strong className={styles.statValue}>{materials.boardCount}</strong><small className={styles.statNote}>{materials.boardColumns} × {materials.boardRows}</small></div></div>
          <div className={styles.craftToolbar}><span className={`${styles.craftMode} ${craftMode ? styles.craftModeActive : ''}`}>{craftMode ? `制作中 · ${progressCount}/${materials.totalBeads}` : '制作模式'}</span><button type="button" className={`${styles.actionButton} ${craftMode ? styles.actionButtonPrimary : ''}`} onClick={() => { setCraftMode((current) => !current); setActivePanel('preview') }}>{craftMode ? '退出' : '开始拼豆'}</button></div>
          {craftMode ? <><div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${progressPercent}%` }} /></div><div className={styles.craftBanner}>{activeMaterial ? `${activeMaterial.code} · ${activeMaterial.quantity} 颗 · 已完成 ${[...completed].filter((index) => pattern.cells[index] === activeMaterial.index).length} 颗` : `完成 ${progressCount} / ${materials.totalBeads} 颗 · ${progressPercent}%`}</div></> : null}
          <div className={styles.materialsHeader}><h2>材料统计</h2><span>每包 {packSize} 颗</span></div>
          <div className={styles.materialsList}>{materials.materials.length ? materials.materials.map((material) => <button type="button" key={material.code} className={styles.materialRow} onClick={() => { setCurrentColorIndex(material.index); if (craftMode) setCraftColor(material.index) }}><i className={styles.materialSwatch} style={{ background: material.hex }} /><span className={styles.materialInfo}><b className={styles.materialCode}>{material.code} · {material.brand}</b><small className={styles.materialName}>{material.name}<span className={styles.materialBar}><i className={styles.materialBarFill} style={{ width: `${Math.max(4, material.percentage)}%` }} /></span></small></span><span className={styles.materialQuantity}>{material.quantity}<small className={styles.materialPercentage}>{material.percentage.toFixed(1)}%</small></span></button>) : <p className={styles.settingsSubtle}>生成图纸后会显示需要的颜色和数量。</p>}</div>
          <div className={styles.materialsTools}><label htmlFor="studio-pack-size">材料包计算</label><div className={styles.sizeRow}><select id="studio-pack-size" className={styles.miniSelect} value={packSize === 500 || packSize === 1000 || packSize === 2000 ? packSize : 'custom'} onChange={(event) => setPackSize(event.target.value === 'custom' ? (packSize === 500 || packSize === 1000 || packSize === 2000 ? 750 : packSize) : Number(event.target.value))}><option value="500">500 / 包</option><option value="1000">1000 / 包</option><option value="2000">2000 / 包</option><option value="custom">自定义</option></select><select className={styles.miniSelect} value={replaceWith} onChange={(event) => setReplaceWith(Number(event.target.value))}>{palette.map((color, index) => <option key={color.code} value={index}>{color.code}</option>)}</select></div>{packSize !== 500 && packSize !== 1000 && packSize !== 2000 ? <input className={styles.miniNumberInput} type="number" min="1" max="100000" value={packSize} onChange={(event) => setPackSize(Math.max(1, Math.min(100000, Number(event.target.value) || 1)))} aria-label="自定义每包拼豆数量" /> : null}<button type="button" className={styles.actionButton} onClick={replaceSelectedColor}>将 {palette[currentColorIndex]?.code || '当前色'} 全部换成 {palette[replaceWith]?.code || ''}</button></div>
          <div className={styles.panelSection}><div className={styles.panelHeader}><div><span className={styles.panelStep}>VIEW / OPTIONS</span><h2 className={styles.panelTitle}>显示与导出</h2></div></div><label className={styles.checkboxRow}><input className={styles.checkbox} type="checkbox" checked={displayBoardLines} onChange={(event) => setDisplayBoardLines(event.target.checked)} />显示 29 × 29 底板边界</label><label className={styles.checkboxRow} style={{ marginTop: 9 }}><input className={styles.checkbox} type="checkbox" checked={displayCoordinates} onChange={(event) => setDisplayCoordinates(event.target.checked)} />显示全局坐标</label><label className={styles.checkboxRow} style={{ marginTop: 9 }}><input className={styles.checkbox} type="checkbox" checked={transparentBackground} onChange={(event) => setTransparentBackground(event.target.checked)} />PNG 导出透明空白格</label><p className={styles.notice}>透明像素会保留为空白格；暗色主题只改变界面，不会改变拼豆本身的颜色。</p></div>
        </aside>
      </div>
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
    </div>
    {toast ? <div className={styles.toast} role="status">{toast}{!isAuthenticated && toast.includes('登录') ? <Link className={styles.toastLink} href="/login?redirect=%2Fstudio%2Fbeads">去登录</Link> : null}</div> : null}
  </StudioToolShell>
}
