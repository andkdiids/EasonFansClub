'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import { getPageLayoutModule } from '@/lib/page-layout/registry'
import type { PageLayoutBehavior, PageLayoutConfig, PageLayoutDevice, PageLayoutGridItem, PageLayoutModuleConfig, PageLayoutPageKey } from '@/lib/page-layout/types'

export type PageLayoutModuleDensity = 'normal' | 'compact' | 'minimal'

export type PageLayoutRenderContext = {
  device: PageLayoutDevice
  grid: PageLayoutGridItem
  columns: number
  density: PageLayoutModuleDensity
  layoutBehavior: PageLayoutBehavior
}

export type PageLayoutModuleRenderer = (item: PageLayoutModuleConfig, context: PageLayoutRenderContext) => ReactNode
export type PageLayoutRendererModules = Record<string, ReactNode | PageLayoutModuleRenderer>

function normalizeLayoutDevice(device: PageLayoutDevice): PageLayoutDevice {
  return device === 'mobile' ? 'mobile' : 'desktop'
}

function useLayoutDevice(forcedDevice?: PageLayoutDevice) {
  const [device, setDevice] = useState<PageLayoutDevice>(forcedDevice ? normalizeLayoutDevice(forcedDevice) : 'desktop')

  useEffect(() => {
    if (forcedDevice) {
      setDevice(normalizeLayoutDevice(forcedDevice))
      return
    }
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setDevice(query.matches ? 'mobile' : 'desktop')
    update()
    query.addEventListener('change', update)
    return () => {
      query.removeEventListener('change', update)
    }
  }, [forcedDevice])

  return device
}

export function getPageLayoutModuleDensity(grid: PageLayoutGridItem): PageLayoutModuleDensity {
  if (grid.h <= 4) return 'minimal'
  if (grid.h <= 6) return 'compact'
  return 'normal'
}

function renderModuleContent(modules: PageLayoutRendererModules, item: PageLayoutModuleConfig, context: PageLayoutRenderContext) {
  const content = modules[item.key]
  return typeof content === 'function' ? content(item, context) : content
}

function getLayoutBehavior(pageKey: PageLayoutPageKey, item: PageLayoutModuleConfig): PageLayoutBehavior {
  return getPageLayoutModule(pageKey, item.key)?.layoutBehavior || 'fixed'
}

export function getPageLayoutModules(config: PageLayoutConfig, device: PageLayoutDevice, pageKey?: PageLayoutPageKey) {
  const activeDevice = normalizeLayoutDevice(device)
  return [...config[activeDevice]]
    .filter((item) => item.visible && !item.isHidden && (!pageKey || Boolean(getPageLayoutModule(pageKey, item.key))))
    .sort((a, b) => a.grid[activeDevice].y - b.grid[activeDevice].y || a.grid[activeDevice].x - b.grid[activeDevice].x || a.order - b.order)
}

export function PageLayoutRenderer({
  pageKey,
  config,
  modules,
  device: forcedDevice,
  previewMode = false,
  className = '',
}: {
  pageKey: PageLayoutPageKey
  config: PageLayoutConfig
  modules: PageLayoutRendererModules
  device?: PageLayoutDevice
  previewMode?: boolean
  className?: string
}) {
  const device = useLayoutDevice(forcedDevice)
  const columns = device === 'mobile' ? 4 : 12
  const items = useMemo(() => getPageLayoutModules(config, device, pageKey), [config, device, pageKey])
  const renderedItems = useMemo(() => items.map((item) => {
    const grid = item.grid[device]
    const density = getPageLayoutModuleDensity(grid)
    const layoutBehavior = getLayoutBehavior(pageKey, item)
    const content = renderModuleContent(modules, item, { device, grid, columns, density, layoutBehavior })
    if (!content) return null
    const span = Math.max(1, Math.min(grid.w, columns))
    const start = Math.max(1, Math.min(grid.x + 1, columns - span + 1))
    return (
      <PageLayoutFrame
        key={item.key}
        config={item}
        className="page-layout-auto-flow-item"
        style={device === 'mobile' ? undefined : { gridColumn: `${start} / span ${span}` }}
        data-grid-w={grid.w}
        data-grid-h={grid.h}
        data-layout-density={density}
        data-layout-behavior="auto"
      >
        {content}
      </PageLayoutFrame>
    )
  }).filter(Boolean), [columns, device, items, modules, pageKey])

  return (
    <div
      data-layout-page={pageKey}
      data-layout-preview={previewMode ? 'true' : 'false'}
      className={`page-layout-flow page-layout-flow-${device} @container ${className}`.trim()}
    >
      {renderedItems.length ? (
        <div
          className={`page-layout-auto-flow page-layout-auto-flow-${device}`}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {renderedItems}
        </div>
      ) : null}
    </div>
  )
}
