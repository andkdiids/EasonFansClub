'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  Responsive,
  WidthProvider,
  type Layout,
  type ResponsiveLayouts,
} from 'react-grid-layout/legacy'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import { getPageLayoutModuleDensity, type PageLayoutModuleRenderer, type PageLayoutRenderContext } from '@/components/page-layout/PageLayoutRenderer'
import { PAGE_LAYOUT_ROW_GAP, PAGE_LAYOUT_ROW_HEIGHT, pixelsToGridHeight } from '@/lib/page-layout/constants'
import type { PageLayoutConfig, PageLayoutDevice, PageLayoutModuleConfig, PageLayoutModuleDefinition, PageLayoutPageKey } from '@/lib/page-layout/types'

export type PageLayoutCanvasModules = Record<string, PageLayoutModuleRenderer>

const ResponsiveGridLayout = WidthProvider(Responsive)

const breakpoints: Record<PageLayoutDevice, number> = {
  desktop: 1200,
  tablet: 768,
  mobile: 0,
}

const cols: Record<PageLayoutDevice, number> = {
  desktop: 12,
  tablet: 8,
  mobile: 4,
}

const contentHeightSafety = 8

function getLayoutCacheKey(pageKey: PageLayoutPageKey, device: PageLayoutDevice, key: string) {
  return `${pageKey}:${device}:${key}`
}

function renderModuleContent(modules: PageLayoutCanvasModules, item: PageLayoutModuleConfig, device: PageLayoutDevice): ReturnType<PageLayoutCanvasModules[string]> {
  const content = modules[item.key]
  const grid = item.grid[device]
  const context: PageLayoutRenderContext = {
    device,
    grid,
    columns: cols[device],
    density: getPageLayoutModuleDensity(grid),
    layoutBehavior: 'fixed',
  }
  return content?.(item, context)
}

function toLayout(
  items: PageLayoutModuleConfig[] | undefined,
  device: PageLayoutDevice,
  definitions: PageLayoutModuleDefinition[] = [],
): Layout {
  const definitionsByKey = new Map(definitions.map((item) => [item.key, item]))
  return (items || [])
    .filter((item) => item.visible && !item.isHidden)
    .map((item) => {
      const definition = definitionsByKey.get(item.key)
      const grid = item.grid[device]
      return {
        i: item.key,
        x: grid.x,
        y: grid.y,
        w: grid.w,
        h: grid.h,
        minW: Math.min(definition?.minW ?? 1, cols[device]),
        minH: Math.min(definition?.minH ?? 1, 40),
        maxW: cols[device],
        maxH: 40,
        isDraggable: definition?.canMove ?? true,
        isResizable: definition?.canResize ?? true,
      }
    })
}

function sortByGrid(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  return [...items].sort(
    (a, b) =>
      a.grid[device].y - b.grid[device].y ||
      a.grid[device].x - b.grid[device].x ||
      a.order - b.order
  )
}

function applyLayout(items: PageLayoutModuleConfig[], device: PageLayoutDevice, layout: Layout) {
  const byKey = new Map(layout.map((item) => [item.i, item]))
  return sortByGrid(
    items.map((item) => {
    const next = byKey.get(item.key)

    if (!next) return item
    const width = Math.max(1, Math.min(cols[device], next.w))

    return {
      ...item,
      grid: {
        ...item.grid,
        [device]: {
          x: Math.max(0, Math.min(cols[device] - width, next.x)),
          y: Math.max(0, next.y),
          w: width,
          h: Math.max(1, Math.min(40, next.h)),
        },
      },
    }
  }),
  device
  ).map((item, index) => ({
    ...item,
    order: (index + 1) * 10,
  }))
}
function hasGridChange(current: PageLayoutModuleConfig[], next: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  const byKey = new Map(current.map((item) => [item.key, item]))
  return next.some((item) => {
    const previous = byKey.get(item.key)
    if (!previous || previous.order !== item.order) return true
    const beforeGrid = previous.grid[device]
    const afterGrid = item.grid[device]
    return beforeGrid.x !== afterGrid.x || beforeGrid.y !== afterGrid.y || beforeGrid.w !== afterGrid.w || beforeGrid.h !== afterGrid.h
  })
}

export function PageLayoutCanvasEditor({
  pageKey,
  config,
  modules,
  moduleDefinitions,
  device,
  selectedKey,
  readOnly = false,
  onSelect,
  onChange,
  onAutoHeightChange,
}: {
  pageKey: PageLayoutPageKey
  config: PageLayoutConfig
  modules: PageLayoutCanvasModules
  moduleDefinitions: PageLayoutModuleDefinition[]
  device: PageLayoutDevice
  selectedKey: string
  readOnly?: boolean
  onSelect: (key: string) => void
  onChange: (items: PageLayoutModuleConfig[]) => void
  onAutoHeightChange: (key: string, nextH: number) => void
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
  const items = useMemo(() => sortByGrid((config[device] || []).filter((item) => item.visible && !item.isHidden), device), [config, device])
  const visibleKeys = items.map((item) => item.key).join('|')
  const layouts = useMemo<ResponsiveLayouts<PageLayoutDevice>>(() => ({
    desktop: toLayout(config.desktop, 'desktop', moduleDefinitions),
    tablet: toLayout(config.tablet, 'tablet', moduleDefinitions),
    mobile: toLayout(config.mobile, 'mobile', moduleDefinitions),
  }), [config, moduleDefinitions])

  useEffect(() => {
    if (readOnly || typeof ResizeObserver === 'undefined') return
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
        const cacheKey = getLayoutCacheKey(pageKey, activeDevice, key)
        const contentHeight = element.scrollHeight + contentHeightSafety
        const contentPreferredH = Math.min(40, pixelsToGridHeight(contentHeight))
        contentPreferredHeightRef.current.set(cacheKey, contentPreferredH)
        const currentH = item.grid[activeDevice].h
        const definitionMinH = moduleDefinitions.find((definition) => definition.key === key)?.minH ?? 1
        const preferredH = contentPreferredHeightRef.current.get(cacheKey) ?? contentPreferredH
        const finalH = Math.max(definitionMinH, preferredH)
        const autoAppliedHeight = autoAppliedHeightRef.current.get(cacheKey)
        if (finalH === currentH) return
        if (applyingAutoHeights.has(cacheKey) && autoAppliedHeight === finalH) return
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
          onAutoHeightChangeRef.current(change.key, change.height)
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
  }, [device, moduleDefinitions, pageKey, readOnly, visibleKeys])

  function applyUserLayout(layout: Layout) {
    if (readOnly) return
    const nextItems = applyLayout(config[device], device, layout)
    if (!hasGridChange(config[device], nextItems, device)) return
    onChange(nextItems)
  }

  return (
    <div
      ref={canvasRef}
      data-layout-page={pageKey}
      data-layout-preview="true"
      data-layout-canvas="react-grid-layout"
      className={`page-layout-canvas page-layout-canvas-${device}`}
    >
      <ResponsiveGridLayout
        className="page-layout-rgl"
        breakpoints={breakpoints}
        cols={cols}
        breakpoint={device}
        layouts={layouts}
        rowHeight={PAGE_LAYOUT_ROW_HEIGHT}
        margin={[PAGE_LAYOUT_ROW_GAP, PAGE_LAYOUT_ROW_GAP]}
        containerPadding={[0, 0]}
        compactType="vertical"
        preventCollision={false}
        allowOverlap={false}
        isDraggable={!readOnly}
        isResizable={!readOnly}
        isBounded
        resizeHandles={['e']}
        draggableCancel=".layout-editor-control, input, textarea, select, button, a"
        useCSSTransforms
        onDragStart={(_, oldItem) => { isUserInteractingRef.current = true; if (!readOnly && oldItem) onSelect(oldItem.i) }}
        onResizeStart={(_, oldItem) => { isUserInteractingRef.current = true; if (!readOnly && oldItem) onSelect(oldItem.i) }}
        onDragStop={(layout) => { isUserInteractingRef.current = false; applyUserLayout(layout) }}
        onResizeStop={(layout) => {
          isUserInteractingRef.current = false
          applyUserLayout(layout)
        }}
      >
        {items.map((item) => {
          const content = renderModuleContent(modules, item, device)
          if (!content) return null
          return (
            <div key={item.key} className={`page-layout-canvas-grid-item ${selectedKey === item.key ? 'page-layout-canvas-grid-item-selected' : ''}`}>
              <PageLayoutFrame
                config={item}
                className="page-layout-grid-item page-layout-canvas-item"
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.key)}
                  className="layout-editor-control absolute right-3 top-3 z-10 rounded-full bg-brand-950 px-2 py-1 text-[10px] font-black text-white shadow-sm"
                >
                  选中
                </button>
                <div className="page-layout-content-shell">
                  <div data-layout-content-measure="true" data-layout-content-key={item.key} className="page-layout-content-measure">
                    {content}
                  </div>
                </div>
              </PageLayoutFrame>
            </div>
          )
        })}
      </ResponsiveGridLayout>
      {!items.length ? (
        <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm font-black text-slate-500">当前设备没有可显示模块</p>
      ) : null}
    </div>
  )
}
