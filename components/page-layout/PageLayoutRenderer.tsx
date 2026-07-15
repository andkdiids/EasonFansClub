'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import type { PageLayoutConfig, PageLayoutDevice, PageLayoutModuleConfig, PageLayoutPageKey } from '@/lib/page-layout/types'

export type PageLayoutRendererModules = Record<string, ReactNode | ((item: PageLayoutModuleConfig) => ReactNode)>

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

function renderModuleContent(modules: PageLayoutRendererModules, item: PageLayoutModuleConfig) {
  const content = modules[item.key]
  return typeof content === 'function' ? content(item) : content
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

  return (
    <div
      data-layout-page={pageKey}
      data-layout-preview={previewMode ? 'true' : 'false'}
      className={`page-layout-grid page-layout-grid-${device} ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const grid = item.grid[device]
        const content = renderModuleContent(modules, item)
        if (!content) return null
        return (
          <PageLayoutFrame
            key={item.key}
            config={item}
            className="page-layout-grid-item"
            style={{
              gridColumn: `${grid.x + 1} / span ${grid.w}`,
              gridRow: `${grid.y + 1} / span ${grid.h}`,
            }}
          >
            {content}
          </PageLayoutFrame>
        )
      })}
    </div>
  )
}
