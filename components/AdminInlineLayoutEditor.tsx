'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  layoutDensities,
  layoutSpacings,
  layoutWidths,
  type PageLayoutConfig,
  type PageLayoutDevice,
  type PageLayoutModuleConfig,
  type PageLayoutModuleDefinition,
  type PageLayoutPageKey,
  type SerializedPageLayout,
} from '@/lib/page-layout/types'

function cloneConfig(config: PageLayoutConfig): PageLayoutConfig {
  return {
    desktop: config.desktop.map((item) => ({ ...item })),
    mobile: config.mobile.map((item) => ({ ...item })),
  }
}

function normalizeOrder(items: PageLayoutModuleConfig[]) {
  return items.map((item, index) => ({ ...item, order: (index + 1) * 10 }))
}

function findModule(registry: PageLayoutModuleDefinition[], key: string) {
  return registry.find((item) => item.key === key)
}

function getDevice(): PageLayoutDevice {
  if (typeof window === 'undefined') return 'desktop'
  return window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
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
    () => (workingConfig ? [...workingConfig[device]].sort((a, b) => a.order - b.order) : []),
    [workingConfig, device],
  )
  const selected = modules.find((item) => item.key === selectedKey) || modules[0]
  const selectedModule = selected ? findModule(layout?.registry || [], selected.key) : null

  useEffect(() => {
    document.body.classList.add('layout-inline-editing')
    return () => {
      document.body.classList.remove('layout-inline-editing')
      document.querySelectorAll<HTMLElement>('[data-layout-module]').forEach((element) => {
        element.style.order = ''
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
      element.style.order = String(config.order)
      element.style.display = config.visible ? '' : 'none'
      element.dataset.layoutLabel = key
      element.dataset.layoutSelected = key === selected?.key ? 'true' : 'false'
    })
  }, [workingConfig, device, selected?.key])

  function updateDeviceItems(updater: (items: PageLayoutModuleConfig[]) => PageLayoutModuleConfig[]) {
    setIsDirty(true)
    setWorkingConfig((current) => current ? { ...current, [device]: updater([...current[device]].sort((a, b) => a.order - b.order)) } : current)
  }

  function updateSelected(patch: Partial<PageLayoutModuleConfig>) {
    if (!selected) return
    updateDeviceItems((items) => items.map((item) => (item.key === selected.key ? { ...item, ...patch } : item)))
  }

  function moveModule(direction: -1 | 1) {
    if (!selected) return
    updateDeviceItems((items) => {
      const index = items.findIndex((item) => item.key === selected.key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= items.length) return items
      const next = [...items]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return normalizeOrder(next)
    })
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
      <div className="fixed bottom-20 right-4 z-50 max-w-sm rounded-2xl border border-sky-100 bg-white p-4 text-sm font-black text-slate-600 shadow-xl">
        {error || '正在进入布局编辑模式...'}
      </div>
    )
  }

  return (
    <aside className="fixed bottom-20 right-4 z-50 max-h-[75vh] w-[min(92vw,360px)] overflow-auto rounded-2xl border border-sky-100 bg-white p-4 shadow-2xl shadow-sky-900/20 md:bottom-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Inline Layout</p>
          <h2 className="mt-1 text-lg font-black text-brand-950">前台布局编辑</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">{device === 'desktop' ? '桌面端' : '移动端'} · v{layout.version}{isDirty ? ' · 未保存' : ''}</p>
        </div>
        <button onClick={exitEditMode} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700">退出</button>
      </div>

      {message ? <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">{error}</p> : null}

      <div className="mt-4 grid gap-2">
        {modules.map((item, index) => {
          const definition = findModule(layout.registry, item.key)
          return (
            <button
              key={item.key}
              onClick={() => setSelectedKey(item.key)}
              className={`rounded-xl border px-3 py-2 text-left ${selected?.key === item.key ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}
            >
              <span className="text-sm font-black text-brand-950">#{index + 1} {definition?.name || item.key}</span>
              <span className="mt-1 block text-xs font-bold text-slate-500">{item.visible ? '显示' : '隐藏'} · {item.width} · {item.gapTop}/{item.gapBottom}</span>
            </button>
          )
        })}
      </div>

      {selected && selectedModule ? (
        <div className="mt-4 space-y-3 border-t border-sky-100 pt-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => moveModule(-1)} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700">上移</button>
            <button onClick={() => moveModule(1)} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700">下移</button>
            <button disabled={selectedModule.required} onClick={() => updateSelected({ visible: !selected.visible })} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700 disabled:opacity-50">{selected.visible ? '隐藏' : '显示'}</button>
          </div>
          <InlineSelect label="宽度" value={selected.width} options={layoutWidths.filter((item) => selectedModule.allowedWidths.includes(item))} onChange={(value) => updateSelected({ width: value as PageLayoutModuleConfig['width'] })} />
          <InlineSelect label="上间距" value={selected.gapTop} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} onChange={(value) => updateSelected({ gapTop: value as PageLayoutModuleConfig['gapTop'] })} />
          <InlineSelect label="下间距" value={selected.gapBottom} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} onChange={(value) => updateSelected({ gapBottom: value as PageLayoutModuleConfig['gapBottom'] })} />
          <InlineSelect label="密度" value={selected.density} options={layoutDensities} onChange={(value) => updateSelected({ density: value as PageLayoutModuleConfig['density'] })} />
          {selectedModule.supportsTitle ? (
            <label className="block">
              <span className="text-xs font-black text-slate-600">标题</span>
              <input value={selected.title || ''} maxLength={60} onChange={(event) => updateSelected({ title: event.target.value })} className="mt-1 w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-bold outline-none" />
            </label>
          ) : null}
          {selectedModule.supportsSubtitle ? (
            <label className="block">
              <span className="text-xs font-black text-slate-600">副标题</span>
              <textarea value={selected.subtitle || ''} maxLength={160} onChange={(event) => updateSelected({ subtitle: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-bold outline-none" />
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-sky-100 pt-4">
        <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/draft`, 'PUT', '草稿已保存')} className="rounded-full bg-brand-700 px-4 py-2 text-xs font-black text-white">保存草稿</button>
        <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/publish`, 'POST', '布局已发布')} className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">发布</button>
      </div>
    </aside>
  )
}

function InlineSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-black text-slate-600">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none">
        {options.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}
