'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import { PAGE_LAYOUT_ROW_GAP, PAGE_LAYOUT_ROW_HEIGHT } from '@/lib/page-layout/constants'
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

function useLayoutDevice(forcedDevice?: PageLayoutDevice) {
  const [device, setDevice] = useState<PageLayoutDevice>(forcedDevice || 'desktop')

  useEffect(() => {
    if (forcedDevice) {
      setDevice(forcedDevice)
      return
    }
    const query = window.matchMedia('(max-width: 767px)')
    const tabletQuery = window.matchMedia('(max-width: 1100px)')
    const update = () => setDevice(query.matches ? 'mobile' : tabletQuery.matches ? 'tablet' : 'desktop')
    update()
    query.addEventListener('change', update)
    tabletQuery.addEventListener('change', update)
    return () => {
      query.removeEventListener('change', update)
      tabletQuery.removeEventListener('change', update)
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

export function getPageLayoutModules(config: PageLayoutConfig, device: PageLayoutDevice) {
  return [...config[device]]
    .filter((item) => item.visible && !item.isHidden)
    .sort((a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order)
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
  const columns = device === 'desktop' ? 12 : device === 'tablet' ? 8 : 4
  const items = useMemo(() => getPageLayoutModules(config, device), [config, device])
  const segments = useMemo(() => {
    const result: Array<{ type: 'fixed'; items: PageLayoutModuleConfig[] } | { type: 'auto'; items: PageLayoutModuleConfig[] }> = []
    items.forEach((item) => {
      const behavior = getLayoutBehavior(pageKey, item)
      if (behavior === 'auto') {
        const previous = result[result.length - 1]
        if (previous?.type === 'auto') {
          previous.items.push(item)
        } else {
          result.push({ type: 'auto', items: [item] })
        }
        return
      }
      const previous = result[result.length - 1]
      if (previous?.type === 'fixed') {
        previous.items.push(item)
      } else {
        result.push({ type: 'fixed', items: [item] })
      }
    })
    return result
  }, [items, pageKey])

  return (
    <div
      data-layout-page={pageKey}
      data-layout-preview={previewMode ? 'true' : 'false'}
      className={`page-layout-flow page-layout-flow-${device} ${className}`.trim()}
    >
      {segments.map((segment, segmentIndex) => {
        if (segment.type === 'auto') {
          const renderedItems = segment.items.map((item) => {
            const grid = item.grid[device]
            const density = getPageLayoutModuleDensity(grid)
            const layoutBehavior = 'auto'
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
                data-layout-behavior={layoutBehavior}
              >
                {content}
              </PageLayoutFrame>
            )
          }).filter(Boolean)
          if (!renderedItems.length) return null
          return (
            <div
              key={`auto-${segmentIndex}`}
              className={`page-layout-auto-flow page-layout-auto-flow-${device}`}
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {renderedItems}
            </div>
          )
        }

        const minY = Math.min(...segment.items.map((item) => item.grid[device].y))
        return (
          <div
            key={`fixed-${segmentIndex}`}
            className={`page-layout-grid page-layout-grid-${device}`}
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: `${PAGE_LAYOUT_ROW_HEIGHT}px`,
              columnGap: `${PAGE_LAYOUT_ROW_GAP}px`,
              rowGap: `${PAGE_LAYOUT_ROW_GAP}px`,
            }}
          >
            {segment.items.map((item) => {
              const grid = item.grid[device]
              const density = getPageLayoutModuleDensity(grid)
              const layoutBehavior = 'fixed'
              const content = renderModuleContent(modules, item, { device, grid, columns, density, layoutBehavior })
              if (!content) return null
              return (
                <PageLayoutFrame
                  key={item.key}
                  config={item}
                  className="page-layout-grid-item page-layout-grid-item-fixed"
                  style={{
                    gridColumn: `${grid.x + 1} / span ${grid.w}`,
                    gridRow: `${grid.y - minY + 1} / span ${grid.h}`,
                  }}
                  data-grid-w={grid.w}
                  data-grid-h={grid.h}
                  data-layout-density={density}
                  data-layout-behavior={layoutBehavior}
                >
                  {content}
                </PageLayoutFrame>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
