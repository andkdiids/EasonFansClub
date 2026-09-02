'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  default as ReactGridLayout,
  WidthProvider,
  type Layout,
} from 'react-grid-layout/legacy'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import { PAGE_LAYOUT_ROW_GAP, PAGE_LAYOUT_ROW_HEIGHT, gridHeightToPixels, pixelsToGridHeight } from '@/lib/page-layout/constants'
import { getPageLayoutModule, getPageLayoutRegistry } from '@/lib/page-layout/registry'
import type {
  PageLayoutBehavior,
  PageLayoutConfig,
  PageLayoutDevice,
  PageLayoutGridItem,
  PageLayoutModuleConfig,
  PageLayoutModuleDefinition,
  PageLayoutPageKey,
} from '@/lib/page-layout/types'

export type PageLayoutModuleDensity = 'normal' | 'compact' | 'minimal'
export type PageLayoutRenderMode = 'live' | 'editor'

export type PageLayoutRenderContext = {
  device: PageLayoutDevice
  grid: PageLayoutGridItem
  columns: number
  density: PageLayoutModuleDensity
  layoutBehavior: PageLayoutBehavior
}

export type PageLayoutModuleRenderer = (item: PageLayoutModuleConfig, context: PageLayoutRenderContext) => ReactNode
export type PageLayoutRendererModules = Record<string, ReactNode | PageLayoutModuleRenderer>

export const PAGE_LAYOUT_COLUMNS: Record<PageLayoutDevice, number> = {
  desktop: 12,
  tablet: 8,
  mobile: 4,
}

export const PAGE_LAYOUT_VIEWPORT_WIDTH: Record<PageLayoutDevice, number> = {
  desktop: 1440,
  tablet: 1024,
  mobile: 390,
}

function normalizeLayoutDevice(device: PageLayoutDevice): PageLayoutDevice {
  return device
}

function useLayoutDevice(forcedDevice?: PageLayoutDevice) {
  const [device, setDevice] = useState<PageLayoutDevice>(forcedDevice ? normalizeLayoutDevice(forcedDevice) : 'desktop')

  useEffect(() => {
    if (forcedDevice) {
      setDevice(normalizeLayoutDevice(forcedDevice))
      return
    }
    const mobileQuery = window.matchMedia('(max-width: 767px)')
    const tabletQuery = window.matchMedia('(min-width: 768px) and (max-width: 1199px)')
    const update = () => setDevice(mobileQuery.matches ? 'mobile' : tabletQuery.matches ? 'tablet' : 'desktop')
    update()
    mobileQuery.addEventListener('change', update)
    tabletQuery.addEventListener('change', update)
    return () => {
      mobileQuery.removeEventListener('change', update)
      tabletQuery.removeEventListener('change', update)
    }
  }, [forcedDevice])

  return device
}

export function getPageLayoutColumns(device: PageLayoutDevice) {
  return PAGE_LAYOUT_COLUMNS[device]
}

export function getPageLayoutModuleDensity(grid: PageLayoutGridItem): PageLayoutModuleDensity {
  if (grid.h <= 4) return 'minimal'
  if (grid.h <= 6) return 'compact'
  return 'normal'
}

function getLayoutBehavior(pageKey: PageLayoutPageKey, item: PageLayoutModuleConfig): PageLayoutBehavior {
  return getPageLayoutModule(pageKey, item.key)?.layoutBehavior || 'auto'
}

function getModuleDefinition(pageKey: PageLayoutPageKey, key: string) {
  return getPageLayoutModule(pageKey, key)
}

function renderModuleContent(modules: PageLayoutRendererModules, item: PageLayoutModuleConfig, context: PageLayoutRenderContext) {
  const content = modules[item.key]
  return typeof content === 'function' ? content(item, context) : content
}

export function getPageLayoutModules(config: PageLayoutConfig, device: PageLayoutDevice, pageKey?: PageLayoutPageKey) {
  const activeDevice = normalizeLayoutDevice(device)
  return [...(config[activeDevice] || [])]
    .filter((item) => item.visible && !item.isHidden && (!pageKey || Boolean(getPageLayoutModule(pageKey, item.key))))
    .sort((a, b) => a.grid[activeDevice].y - b.grid[activeDevice].y || a.grid[activeDevice].x - b.grid[activeDevice].x || a.order - b.order)
}

function clampGrid(grid: PageLayoutGridItem, device: PageLayoutDevice, definition?: PageLayoutModuleDefinition) {
  const columns = getPageLayoutColumns(device)
  const width = Math.max(1, Math.min(columns, Math.round(grid.w)))
  const maxWidth = Math.min(columns, definition?.maxW ?? columns)
  const safeWidth = Math.max(Math.min(width, maxWidth), Math.min(definition?.minW ?? 1, columns))
  return {
    x: Math.max(0, Math.min(columns - safeWidth, Math.round(grid.x))),
    y: Math.max(0, Math.round(grid.y)),
    w: safeWidth,
    h: Math.max(1, Math.min(40, Math.round(grid.h))),
  }
}

function normalizeGridHeight(grid: PageLayoutGridItem, definition?: PageLayoutModuleDefinition) {
  const minH = Math.max(1, definition?.minH ?? 1)
  const maxH = Math.max(minH, Math.min(40, definition?.maxH ?? 40))
  return Math.max(minH, Math.min(maxH, Math.round(grid.h)))
}

/** Convert the persisted schema into the exact grid consumed by the editor. */
export function toPageLayoutGridLayout(
  items: PageLayoutModuleConfig[] | undefined,
  device: PageLayoutDevice,
  definitions: PageLayoutModuleDefinition[] = [],
): Layout {
  const definitionsByKey = new Map(definitions.map((item) => [item.key, item]))
  return (items || [])
    .filter((item) => item.visible && !item.isHidden)
    .map((item) => {
      const definition = definitionsByKey.get(item.key)
      const grid = clampGrid(item.grid[device], device, definition)
      return {
        i: item.key,
        x: grid.x,
        y: grid.y,
        w: grid.w,
        h: normalizeGridHeight(grid, definition),
        minW: Math.min(definition?.minW ?? 1, getPageLayoutColumns(device)),
        minH: Math.min(definition?.minH ?? 1, 40),
        maxW: Math.min(definition?.maxW ?? getPageLayoutColumns(device), getPageLayoutColumns(device)),
        maxH: Math.min(definition?.maxH ?? 40, 40),
        isDraggable: definition?.canMove ?? true,
        isResizable: definition?.canResize ?? true,
      }
    })
}

function sortByGrid(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  return [...items].sort(
    (a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order,
  )
}

/** Apply a react-grid-layout result back to the shared persisted schema. */
export function applyPageLayoutGridLayout(pageKey: PageLayoutPageKey, items: PageLayoutModuleConfig[], device: PageLayoutDevice, layout: Layout) {
  const columns = getPageLayoutColumns(device)
  const byKey = new Map(layout.map((item) => [item.i, item]))
  return sortByGrid(
    items.map((item) => {
      const next = byKey.get(item.key)
      if (!next) return item
      const definition = getPageLayoutModule(pageKey, item.key)
      const width = Math.max(1, Math.min(columns, next.w))
      const minW = Math.min(definition?.minW ?? 1, columns)
      const maxW = Math.min(definition?.maxW ?? columns, columns)
      const safeWidth = Math.max(minW, Math.min(maxW, width))
      const minH = Math.min(definition?.minH ?? 1, 40)
      const maxH = Math.min(definition?.maxH ?? 40, 40)
      return {
        ...item,
        grid: {
          ...item.grid,
          [device]: {
            x: Math.max(0, Math.min(columns - safeWidth, next.x)),
            y: Math.max(0, next.y),
            w: safeWidth,
            h: Math.max(minH, Math.min(maxH, next.h)),
          },
        },
      }
    }),
    device,
  ).map((item, index) => ({ ...item, order: (index + 1) * 10 }))
}

export function hasPageLayoutGridChange(current: PageLayoutModuleConfig[], next: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  const byKey = new Map(current.map((item) => [item.key, item]))
  return next.some((item) => {
    const previous = byKey.get(item.key)
    if (!previous || previous.order !== item.order) return true
    const beforeGrid = previous.grid[device]
    const afterGrid = item.grid[device]
    return beforeGrid.x !== afterGrid.x || beforeGrid.y !== afterGrid.y || beforeGrid.w !== afterGrid.w || beforeGrid.h !== afterGrid.h
  })
}

function fitsPageLayoutGrid(grid: PageLayoutGridItem, occupied: Set<string>, columns: number) {
  if (grid.x < 0 || grid.x + grid.w > columns) return false
  for (let y = grid.y; y < grid.y + grid.h; y += 1) {
    for (let x = grid.x; x < grid.x + grid.w; x += 1) {
      if (occupied.has(`${x}:${y}`)) return false
    }
  }
  return true
}

function occupyPageLayoutGrid(grid: PageLayoutGridItem, occupied: Set<string>) {
  for (let y = grid.y; y < grid.y + grid.h; y += 1) {
    for (let x = grid.x; x < grid.x + grid.w; x += 1) occupied.add(`${x}:${y}`)
  }
}

/** The same collision-free packing algorithm is used by the editor's auto-arrange action. */
export function autoArrangePageLayoutItems(pageKey: PageLayoutPageKey, items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  const columns = getPageLayoutColumns(device)
  const occupied = new Set<string>()
  const active = sortByGrid(items.filter((item) => item.visible && !item.isHidden), device)
  const hidden = items.filter((item) => !item.visible || item.isHidden)
  const arranged = active.map((item, index) => {
    const definition = getPageLayoutModule(pageKey, item.key)
    const current = item.grid[device]
    const width = Math.max(Math.min(definition?.minW ?? 1, columns), Math.min(columns, current.w))
    const height = Math.max(definition?.minH ?? 1, Math.min(40, current.h))
    const candidateBase = { x: 0, y: 0, w: width, h: height }
    let placed = false
    let nextGrid = candidateBase
    for (let y = 0; y < 200 && !placed; y += 1) {
      for (let x = 0; x <= columns - width; x += 1) {
        const candidate = { ...candidateBase, x, y }
        if (!fitsPageLayoutGrid(candidate, occupied, columns)) continue
        nextGrid = candidate
        placed = true
        break
      }
    }
    occupyPageLayoutGrid(nextGrid, occupied)
    return {
      ...item,
      order: (index + 1) * 10,
      grid: { ...item.grid, [device]: nextGrid },
    }
  })
  return [...arranged, ...hidden]
}

function getEditorItemStyle(pageKey: PageLayoutPageKey, item: PageLayoutModuleConfig, device: PageLayoutDevice): CSSProperties {
  const grid = item.grid[device]
  const definition = getModuleDefinition(pageKey, item.key)
  return { minHeight: gridHeightToPixels(normalizeGridHeight(grid, definition || undefined)) }
}

const GridLayout = WidthProvider(ReactGridLayout)

function PageLayoutEditorCanvas({
  pageKey,
  config,
  modules,
  device,
  selectedKey,
  readOnly,
  onSelect,
  onChange,
  onAutoHeightChange,
  viewportWidth,
  className,
}: {
  pageKey: PageLayoutPageKey
  config: PageLayoutConfig
  modules: PageLayoutRendererModules
  device: PageLayoutDevice
  selectedKey: string
  readOnly: boolean
  onSelect?: (key: string) => void
  onChange?: (items: PageLayoutModuleConfig[]) => void
  onAutoHeightChange?: (key: string, nextH: number) => void
  viewportWidth: number
  className?: string
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const configRef = useRef(config)
  const deviceRef = useRef(device)
  const onAutoHeightChangeRef = useRef(onAutoHeightChange)
  const contentPreferredHeightRef = useRef(new Map<string, number>())
  const autoAppliedHeightRef = useRef(new Map<string, number>())
  const pendingAutoHeightRef = useRef(new Map<string, { key: string; device: PageLayoutDevice; height: number }>())
  const isApplyingAutoHeightRef = useRef(new Set<string>())
  const autoHeightFrameRef = useRef<number | null>(null)
  const releaseAutoHeightFrameRef = useRef<number | null>(null)
  const isUserInteractingRef = useRef(false)
  configRef.current = config
  deviceRef.current = device
  onAutoHeightChangeRef.current = onAutoHeightChange

  const definitions = useMemo(() => getPageLayoutRegistry(pageKey), [pageKey])
  const items = useMemo(() => getPageLayoutModules(config, device, pageKey), [config, device, pageKey])
  const visibleKeys = items.map((item) => item.key).join('|')
  const layout = useMemo(() => toPageLayoutGridLayout(config[device], device, definitions), [config, definitions, device])

  useEffect(() => {
    if (readOnly || typeof ResizeObserver === 'undefined' || !onAutoHeightChange) return
    const measureNodes = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>('[data-layout-content-measure="true"]') || [])
    if (!measureNodes.length) return
    const pendingAutoHeights = pendingAutoHeightRef.current
    const applyingAutoHeights = isApplyingAutoHeightRef.current
    const observer = new ResizeObserver((entries) => {
      if (isUserInteractingRef.current) return
      entries.forEach((entry) => {
        const element = entry.target
        if (!(element instanceof HTMLElement)) return
        const key = element.closest<HTMLElement>('[data-layout-module]')?.dataset.layoutModule
        if (!key) return
        const activeDevice = deviceRef.current
        const item = configRef.current[activeDevice].find((candidate) => candidate.key === key)
        if (!item) return
        const cacheKey = `${pageKey}:${activeDevice}:${key}`
        const contentHeight = element.scrollHeight + 8
        const contentPreferredH = Math.min(40, pixelsToGridHeight(contentHeight))
        contentPreferredHeightRef.current.set(cacheKey, contentPreferredH)
        const definition = definitions.find((candidate) => candidate.key === key)
        if (definition?.heightMode === 'FIXED') return
        const currentH = item.grid[activeDevice].h
        const preferredH = contentPreferredHeightRef.current.get(cacheKey) ?? contentPreferredH
        const finalH = Math.max(definition?.minH ?? 1, preferredH)
        const autoAppliedHeight = autoAppliedHeightRef.current.get(cacheKey)
        if (finalH === currentH || (applyingAutoHeights.has(cacheKey) && autoAppliedHeight === finalH)) return
        const pending = pendingAutoHeights.get(cacheKey)
        if (pending?.height === finalH) return
        pendingAutoHeights.set(cacheKey, { key, device: activeDevice, height: finalH })
      })

      if (!pendingAutoHeights.size || autoHeightFrameRef.current !== null) return
      autoHeightFrameRef.current = window.requestAnimationFrame(() => {
        autoHeightFrameRef.current = null
        const pendingChanges = [...pendingAutoHeights.entries()]
        pendingAutoHeights.clear()
        pendingChanges.forEach(([cacheKey, change]) => {
          if (change.device !== deviceRef.current) return
          const currentItem = configRef.current[change.device].find((item) => item.key === change.key)
          if (!currentItem || change.height === currentItem.grid[change.device].h) return
          applyingAutoHeights.add(cacheKey)
          autoAppliedHeightRef.current.set(cacheKey, change.height)
          onAutoHeightChangeRef.current?.(change.key, change.height)
        })
        if (releaseAutoHeightFrameRef.current !== null) window.cancelAnimationFrame(releaseAutoHeightFrameRef.current)
        releaseAutoHeightFrameRef.current = window.requestAnimationFrame(() => {
          releaseAutoHeightFrameRef.current = null
          applyingAutoHeights.clear()
        })
      })
    })
    measureNodes.forEach((node) => observer.observe(node))
    return () => {
      observer.disconnect()
      if (autoHeightFrameRef.current !== null) window.cancelAnimationFrame(autoHeightFrameRef.current)
      if (releaseAutoHeightFrameRef.current !== null) window.cancelAnimationFrame(releaseAutoHeightFrameRef.current)
      autoHeightFrameRef.current = null
      releaseAutoHeightFrameRef.current = null
      pendingAutoHeights.clear()
      applyingAutoHeights.clear()
    }
  }, [definitions, device, pageKey, readOnly, visibleKeys, onAutoHeightChange])

  function applyUserLayout(nextLayout: Layout) {
    if (readOnly || !onChange) return
    const nextItems = applyPageLayoutGridLayout(pageKey, config[device], device, nextLayout)
    if (!hasPageLayoutGridChange(config[device], nextItems, device)) return
    onChange(nextItems)
  }

  return (
    <div
      ref={canvasRef}
      data-layout-page={pageKey}
      data-layout-preview="true"
      data-layout-mode="editor"
      data-layout-canvas="shared-page-layout-renderer"
      className={`page-layout-editor-canvas page-layout-editor-canvas-${device} page-layout-surface-${pageKey} ${className || ''}`.trim()}
      style={{ width: viewportWidth, minWidth: viewportWidth }}
    >
      <GridLayout
        key={`${pageKey}:${device}:${viewportWidth}`}
        className="page-layout-rgl"
        measureBeforeMount
        cols={getPageLayoutColumns(device)}
        layout={layout}
        rowHeight={PAGE_LAYOUT_ROW_HEIGHT}
        margin={[PAGE_LAYOUT_ROW_GAP, PAGE_LAYOUT_ROW_GAP]}
        containerPadding={[0, 0]}
        // The persisted y coordinate is part of the shared WYSIWYG contract.
        // Do not compact on mount, otherwise hidden optional modules create a
        // different canvas than the live CSS-grid renderer. Collision
        // resolution still pushes the item being moved when needed.
        compactType={null}
        preventCollision={false}
        allowOverlap={false}
        isDraggable={!readOnly}
        isResizable={!readOnly}
        isBounded
        resizeHandles={['e', 's', 'se']}
        draggableCancel=".layout-editor-control, input, textarea, select, button, a"
        useCSSTransforms
        onDragStart={(_, oldItem) => {
          isUserInteractingRef.current = true
          if (!readOnly && oldItem) onSelect?.(oldItem.i)
        }}
        onResizeStart={(_, oldItem) => {
          isUserInteractingRef.current = true
          if (!readOnly && oldItem) onSelect?.(oldItem.i)
        }}
        onDragStop={(nextLayout) => {
          isUserInteractingRef.current = false
          applyUserLayout(nextLayout)
        }}
        onResizeStop={(nextLayout) => {
          isUserInteractingRef.current = false
          applyUserLayout(nextLayout)
        }}
      >
        {items.map((item) => {
          const grid = item.grid[device]
          const definition = getModuleDefinition(pageKey, item.key)
          const content = renderModuleContent(modules, item, {
            device,
            grid,
            columns: getPageLayoutColumns(device),
            density: getPageLayoutModuleDensity(grid),
            layoutBehavior: getLayoutBehavior(pageKey, item),
          })
          if (!content) return null
          const selected = selectedKey === item.key
          return (
            <div
              key={item.key}
              data-layout-editor-item={item.key}
              className={`page-layout-editor-grid-item ${selected ? 'page-layout-editor-grid-item-selected' : ''}`}
              onClick={() => onSelect?.(item.key)}
            >
              <PageLayoutFrame
                config={item}
                className="page-layout-grid-item page-layout-editor-item"
                style={getEditorItemStyle(pageKey, item, device)}
                data-grid-w={grid.w}
                data-grid-h={grid.h}
                data-layout-density={getPageLayoutModuleDensity(grid)}
                data-layout-behavior={getLayoutBehavior(pageKey, item)}
                data-layout-label={selected ? definition?.name : undefined}
              >
                <div
                  {...({ inert: true } as Record<string, boolean>)}
                  aria-hidden="true"
                  className="page-layout-editor-content page-layout-content-shell"
                >
                  <div data-layout-content-measure="true" data-layout-content-key={item.key} className="page-layout-content-measure">
                    {content}
                  </div>
                </div>
                {selected ? (
                  <div className="page-layout-editor-overlay" aria-hidden="true">
                    <span>{definition?.name || item.key}</span>
                    <span>{grid.w}/{getPageLayoutColumns(device)} 列 · {grid.h} 行</span>
                  </div>
                ) : null}
              </PageLayoutFrame>
            </div>
          )
        })}
      </GridLayout>
      {!items.length ? <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm font-black text-slate-500">当前设备没有可显示模块</p> : null}
    </div>
  )
}

export function PageLayoutRenderer({
  pageKey,
  config,
  modules,
  device: forcedDevice,
  previewMode = false,
  mode = 'live',
  className = '',
  selectedKey = '',
  readOnly = false,
  onSelect,
  onChange,
  onAutoHeightChange,
  viewportWidth,
}: {
  pageKey: PageLayoutPageKey
  config: PageLayoutConfig
  modules: PageLayoutRendererModules
  device?: PageLayoutDevice
  previewMode?: boolean
  mode?: PageLayoutRenderMode
  className?: string
  selectedKey?: string
  readOnly?: boolean
  onSelect?: (key: string) => void
  onChange?: (items: PageLayoutModuleConfig[]) => void
  onAutoHeightChange?: (key: string, nextH: number) => void
  viewportWidth?: number
}) {
  const device = useLayoutDevice(forcedDevice)
  const columns = getPageLayoutColumns(device)
  const items = useMemo(() => getPageLayoutModules(config, device, pageKey), [config, device, pageKey])

  if (mode === 'editor') {
    return (
      <PageLayoutEditorCanvas
        pageKey={pageKey}
        config={config}
        modules={modules}
        device={device}
        selectedKey={selectedKey}
        readOnly={readOnly}
        onSelect={onSelect}
        onChange={onChange}
        onAutoHeightChange={onAutoHeightChange}
        viewportWidth={viewportWidth || PAGE_LAYOUT_VIEWPORT_WIDTH[device]}
        className={className}
      />
    )
  }

  return (
    <div
      data-layout-page={pageKey}
      data-layout-preview={previewMode ? 'true' : 'false'}
      data-layout-mode="live"
      className={`page-layout-flow page-layout-flow-${device} page-layout-surface-${pageKey} @container ${className}`.trim()}
    >
      {items.length ? (
        <div
          className={`page-layout-grid page-layout-grid-${device}`}
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridAutoRows: `minmax(${PAGE_LAYOUT_ROW_HEIGHT}px, auto)`,
            columnGap: PAGE_LAYOUT_ROW_GAP,
            rowGap: PAGE_LAYOUT_ROW_GAP,
          }}
        >
          {items.map((item) => {
            const grid = item.grid[device]
            const density = getPageLayoutModuleDensity(grid)
            const layoutBehavior = getLayoutBehavior(pageKey, item)
            const content = renderModuleContent(modules, item, { device, grid, columns, density, layoutBehavior })
            if (!content) return null
            const span = Math.max(1, Math.min(grid.w, columns))
            const start = Math.max(1, Math.min(grid.x + 1, columns - span + 1))
            const definition = getModuleDefinition(pageKey, item.key)
            const rowSpan = Math.max(1, Math.min(40, Math.round(grid.h)))
            const frameStyle: CSSProperties = {
              gridColumn: `${start} / span ${span}`,
              gridRow: `${Math.max(1, grid.y + 1)} / span ${rowSpan}`,
              minHeight: gridHeightToPixels(rowSpan),
              height: definition?.heightMode === 'FIXED' ? gridHeightToPixels(rowSpan) : undefined,
            }
            return (
              <PageLayoutFrame
                key={item.key}
                config={item}
                className="page-layout-grid-item page-layout-live-item"
                style={frameStyle}
                data-grid-w={grid.w}
                data-grid-h={grid.h}
                data-layout-density={density}
                data-layout-behavior={layoutBehavior}
              >
                <div className="page-layout-content-shell">{content}</div>
              </PageLayoutFrame>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
