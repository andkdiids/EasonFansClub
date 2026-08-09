'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  PageLayoutConfig,
  PageLayoutDevice,
  PageLayoutGridItem,
  PageLayoutModuleConfig,
  PageLayoutModuleDefinition,
  PageLayoutPageKey,
  SerializedPageLayout,
} from '@/lib/page-layout/types'

function cloneConfig(config: PageLayoutConfig): PageLayoutConfig {
  return {
    desktop: config.desktop.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
    tablet: config.tablet.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
    mobile: config.mobile.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
  }
}

function findModule(registry: PageLayoutModuleDefinition[], key: string) {
  return registry.find((item) => item.key === key)
}

function getDevice(): PageLayoutDevice {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia('(max-width: 767px)').matches) return 'mobile'
  return 'desktop'
}

function columnsFor(device: PageLayoutDevice) {
  return device === 'mobile' ? 4 : 12
}

function patchGrid(item: PageLayoutModuleConfig, device: PageLayoutDevice, patch: Partial<PageLayoutGridItem>) {
  const columns = columnsFor(device)
  const current = item.grid[device]
  const w = Math.max(1, Math.min(columns, patch.w ?? current.w))
  const h = Math.max(1, Math.min(40, patch.h ?? current.h))
  const x = Math.max(0, Math.min(columns - w, patch.x ?? current.x))
  const y = Math.max(0, Math.min(200, patch.y ?? current.y))
  return { ...item, grid: { ...item.grid, [device]: { x, y, w, h } } }
}

function exitEditMode() {
  const url = new URL(window.location.href)
  url.searchParams.delete('layoutEdit')
  window.location.href = `${url.pathname}${url.search}${url.hash}`
}

export function AdminInlineLayoutEditor({ pageKey }: { pageKey: PageLayoutPageKey }) {
  const [layout, setLayout] = useState<SerializedPageLayout | null>(null)
  const [workingConfig, setWorkingConfig] = useState<PageLayoutConfig | null>(null)
  const [device, setDevice] = useState<PageLayoutDevice>(getDevice())
  const [selectedKey, setSelectedKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    const update = () => setDevice(getDevice())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    fetch(`/api/admin/page-layouts/${pageKey}`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.message || '加载布局失败')
        setLayout(data)
        setWorkingConfig(cloneConfig(data.draftConfig))
        setSelectedKey(data.draftConfig[getDevice()]?.[0]?.key || '')
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '加载布局失败'))
  }, [pageKey])

  const modules = useMemo(
    () => (workingConfig ? [...workingConfig[device]].sort((a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order) : []),
    [workingConfig, device],
  )
  const selected = modules.find((item) => item.key === selectedKey) || modules[0]
  const selectedModule = selected ? findModule(layout?.registry || [], selected.key) : null
  const grid = selected?.grid[device]

  useEffect(() => {
    document.body.classList.add('layout-inline-editing')
    return () => {
      document.body.classList.remove('layout-inline-editing')
      document.querySelectorAll<HTMLElement>('[data-layout-module]').forEach((element) => {
        element.style.gridColumn = ''
        element.style.gridRow = ''
        element.style.display = ''
      })
    }
  }, [])

  useEffect(() => {
    if (!workingConfig) return
    const currentModules = [...workingConfig[device]]
    document.querySelectorAll<HTMLElement>('[data-layout-module]').forEach((element) => {
      const key = element.dataset.layoutModule || ''
      const config = currentModules.find((item) => item.key === key)
      if (!config) return
      const nextGrid = config.grid[device]
      element.style.gridColumn = `${nextGrid.x + 1} / span ${nextGrid.w}`
      element.style.gridRow = `${nextGrid.y + 1} / span ${nextGrid.h}`
      element.style.display = config.visible && !config.isHidden ? '' : 'none'
      element.dataset.layoutLabel = key
      element.dataset.layoutSelected = key === selected?.key ? 'true' : 'false'
    })
  }, [workingConfig, device, selected?.key])

  function updateDeviceItems(updater: (items: PageLayoutModuleConfig[]) => PageLayoutModuleConfig[]) {
    setIsDirty(true)
    setWorkingConfig((current) => current ? { ...current, [device]: updater([...current[device]]) } : current)
  }

  function updateSelected(patch: Partial<PageLayoutModuleConfig>) {
    if (!selected) return
    updateDeviceItems((items) => items.map((item) => (item.key === selected.key ? { ...item, ...patch } : item)))
  }

  function updateSelectedGrid(patch: Partial<PageLayoutGridItem>) {
    if (!selected) return
    updateDeviceItems((items) => items.map((item) => (item.key === selected.key ? patchGrid(item, device, patch) : item)))
  }

  async function submit(url: string, method: 'PUT' | 'POST', successMessage: string) {
    if (!layout || !workingConfig) return
    setIsSaving(true)
    setMessage('')
    setError('')
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: layout.version, config: workingConfig }),
    })
    const data = await response.json().catch(() => null)
    setIsSaving(false)
    if (!response.ok) {
      setError(data?.message || '操作失败')
      return
    }
    setLayout(data)
    setWorkingConfig(cloneConfig(data.draftConfig))
    setIsDirty(false)
    setMessage(data.message || successMessage)
  }

  if (!layout || !workingConfig) {
    return (
      <div className="inline-layout-editor fixed bottom-20 right-4 z-50 max-w-sm rounded-2xl border border-sky-100 bg-white p-4 text-sm font-black text-slate-600 shadow-xl">
        {error || '正在进入布局编辑模式...'}
      </div>
    )
  }

  return (
    <aside className="inline-layout-editor fixed bottom-20 right-4 z-50 max-h-[75vh] w-[min(92vw,360px)] overflow-auto rounded-2xl border border-sky-100 bg-white p-4 shadow-2xl shadow-sky-900/20 md:bottom-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Inline Layout v2</p>
          <h2 className="mt-1 text-lg font-black text-brand-950">前台布局编辑</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">{device === 'desktop' ? '桌面端 12 列' : '移动端 4 列'} · v{layout.version}{isDirty ? ' · 未保存' : ''}</p>
        </div>
        <button onClick={exitEditMode} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700">退出</button>
      </div>

      {message ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">{error}</p> : null}

      <div className="mt-4 grid gap-2">
        {modules.map((item, index) => {
          const definition = findModule(layout.registry, item.key)
          const itemGrid = item.grid[device]
          return (
            <button
              key={item.key}
              onClick={() => setSelectedKey(item.key)}
              className={`rounded-xl border px-3 py-2 text-left ${selected?.key === item.key ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}
            >
              <span className="text-sm font-black text-brand-950">#{index + 1} {definition?.name || item.key}</span>
              <span className="mt-1 block text-xs font-bold text-slate-500">{item.visible ? '显示' : '隐藏'} · x{itemGrid.x} y{itemGrid.y} · {itemGrid.w}x{itemGrid.h}</span>
            </button>
          )
        })}
      </div>

      {selected && selectedModule && grid ? (
        <div className="mt-4 space-y-3 border-t border-sky-100 pt-4">
          <button disabled={selectedModule.required || !selectedModule.canHide} onClick={() => updateSelected({ visible: selected.isHidden, isHidden: !selected.isHidden })} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700 disabled:opacity-50">{selected.isHidden ? '显示' : '隐藏'}</button>
          <InlineNumber label="X" value={grid.x} min={0} max={columnsFor(device) - grid.w} onChange={(value) => updateSelectedGrid({ x: value })} />
          <InlineNumber label="Y" value={grid.y} min={0} max={200} onChange={(value) => updateSelectedGrid({ y: value })} />
          <InlineNumber label="W" value={grid.w} min={1} max={columnsFor(device)} onChange={(value) => updateSelectedGrid({ w: value })} />
          <InlineNumber label="H" value={grid.h} min={1} max={40} onChange={(value) => updateSelectedGrid({ h: value })} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-sky-100 pt-4">
        <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/draft`, 'PUT', '草稿已保存')} className="rounded-full bg-brand-700 px-4 py-2 text-xs font-black text-white">保存草稿</button>
        <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/publish`, 'POST', '布局已发布')} className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">发布</button>
      </div>
    </aside>
  )
}

function InlineNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-black text-slate-600">{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} className="mt-1 w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-bold outline-none" />
    </label>
  )
}
