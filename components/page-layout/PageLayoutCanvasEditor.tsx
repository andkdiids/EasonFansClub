'use client'

import { useMemo, type ReactNode } from 'react'
import {
  Responsive,
  WidthProvider,
  type Layout,
  type ResponsiveLayouts,
} from 'react-grid-layout/legacy'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import type { PageLayoutConfig, PageLayoutDevice, PageLayoutModuleConfig, PageLayoutModuleDefinition, PageLayoutPageKey } from '@/lib/page-layout/types'

export type PageLayoutCanvasModules = Record<string, ReactNode | ((item: PageLayoutModuleConfig) => ReactNode)>

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

function renderModuleContent(modules: PageLayoutCanvasModules, item: PageLayoutModuleConfig) {
  const content = modules[item.key]
  return typeof content === 'function' ? content(item) : content
}

function toLayout(items: PageLayoutModuleConfig[] | undefined, device: PageLayoutDevice, definitions: PageLayoutModuleDefinition[] = []): Layout {
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
        minH: definition?.minH ?? 1,
        maxW: Math.min(definition?.maxW ?? cols[device], cols[device]),
        maxH: definition?.maxH ?? 40,
        isDraggable: definition?.canMove ?? true,
        isResizable: definition?.canResize ?? true,
      }
    })
}

function sortByGrid(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  return [...items].sort((a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order)
}

function applyLayout(items: PageLayoutModuleConfig[], device: PageLayoutDevice, layout: Layout) {
  const byKey = new Map(layout.map((item) => [item.i, item]))
  return sortByGrid(items.map((item) => {
    const next = byKey.get(item.key)
    if (!next) return item
    return {
      ...item,
      grid: {
        ...item.grid,
        [device]: {
          x: Math.max(0, next.x),
          y: Math.max(0, next.y),
          w: Math.max(1, Math.min(cols[device], next.w)),
          h: Math.max(1, Math.min(40, next.h)),
        },
      },
    }
  }), device).map((item, index) => ({ ...item, order: (index + 1) * 10 }))
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
}) {
  const items = useMemo(() => sortByGrid((config[device] || []).filter((item) => item.visible && !item.isHidden), device), [config, device])
  const layouts = useMemo<ResponsiveLayouts<PageLayoutDevice>>(() => ({
    desktop: toLayout(config.desktop, 'desktop', moduleDefinitions),
    tablet: toLayout(config.tablet, 'tablet', moduleDefinitions),
    mobile: toLayout(config.mobile, 'mobile', moduleDefinitions),
  }), [config, moduleDefinitions])

  return (
    <div
      data-layout-page={pageKey}
      data-layout-preview="true"
      data-layout-canvas="react-grid-layout"
      className={`page-layout-canvas page-layout-canvas-${device}`}
    >
      <ResponsiveGridLayout
        className="page-layout-rgl"
        breakpoints={breakpoints}
        cols={cols}
        layouts={layouts}
        breakpoint={device}
        rowHeight={36}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        compactType="vertical"
        preventCollision={false}
        allowOverlap={false}
        isDraggable={!readOnly}
        isResizable={!readOnly}
        isBounded
        resizeHandles={['se', 'e', 's']}
        draggableCancel=".layout-editor-control, input, textarea, select, button, a"
        useCSSTransforms
        onDragStart={(_, oldItem) => { if (oldItem) onSelect(oldItem.i) }}
        onResizeStart={(_, oldItem) => { if (oldItem) onSelect(oldItem.i) }}
        onLayoutChange={(layout) => {
          if (readOnly) return
          const nextItems = applyLayout(config[device], device, layout)
          if (hasGridChange(config[device], nextItems, device)) onChange(nextItems)
        }}
      >
        {items.map((item) => {
          const content = renderModuleContent(modules, item)
          if (!content) return null
          return (
            <div key={item.key} className="min-w-0">
              <PageLayoutFrame
                config={item}
                className={`page-layout-grid-item page-layout-canvas-item h-full ${selectedKey === item.key ? 'page-layout-canvas-item-selected' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.key)}
                  className="layout-editor-control absolute right-3 top-3 z-10 rounded-full bg-brand-950 px-2 py-1 text-[10px] font-black text-white shadow-sm"
                >
                  选中
                </button>
                {content}
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
