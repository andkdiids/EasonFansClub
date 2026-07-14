'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import {
  layoutAlignments,
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

const pageOptions: { key: PageLayoutPageKey; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'checkin', label: '每日挂号' },
  { key: 'admin-home', label: '管理后台首页' },
]

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

function formatDate(value: string | null) {
  if (!value) return '尚未发布'
  return new Date(value).toLocaleString('zh-CN')
}

export function LayoutEditorClient({ initialPage }: { initialPage: PageLayoutPageKey }) {
  const [pageKey, setPageKey] = useState<PageLayoutPageKey>(initialPage)
  const [device, setDevice] = useState<PageLayoutDevice>('desktop')
  const [layout, setLayout] = useState<SerializedPageLayout | null>(null)
  const [workingConfig, setWorkingConfig] = useState<PageLayoutConfig | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [draggingKey, setDraggingKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setMessage('')
    setError('')
    setLayout(null)
    setWorkingConfig(null)
    fetch(`/api/admin/page-layouts/${pageKey}`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.message || '加载布局失败')
        setLayout(data)
        setWorkingConfig(cloneConfig(data.draftConfig))
        setSelectedKey(data.draftConfig.desktop?.[0]?.key || '')
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
    if (modules.length && !modules.some((item) => item.key === selectedKey)) {
      setSelectedKey(modules[0].key)
    }
  }, [modules, selectedKey])

  function updateDeviceItems(updater: (items: PageLayoutModuleConfig[]) => PageLayoutModuleConfig[]) {
    setWorkingConfig((current) => current ? { ...current, [device]: updater([...current[device]].sort((a, b) => a.order - b.order)) } : current)
  }

  function updateSelected(patch: Partial<PageLayoutModuleConfig>) {
    if (!selected) return
    updateDeviceItems((items) => items.map((item) => (item.key === selected.key ? { ...item, ...patch } : item)))
  }

  function moveModule(key: string, direction: -1 | 1) {
    updateDeviceItems((items) => {
      const index = items.findIndex((item) => item.key === key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= items.length) return items
      const next = [...items]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return normalizeOrder(next)
    })
  }

  function dropModule(targetKey: string) {
    if (!draggingKey || draggingKey === targetKey) return
    updateDeviceItems((items) => {
      const from = items.findIndex((item) => item.key === draggingKey)
      const to = items.findIndex((item) => item.key === targetKey)
      if (from < 0 || to < 0) return items
      const next = [...items]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return normalizeOrder(next)
    })
    setDraggingKey('')
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
    setMessage(data.message || successMessage)
  }

  if (!workingConfig || !layout) {
    return (
      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-6 text-sm font-black text-slate-600 shadow-sm">
        {error || '正在加载布局编辑器...'}
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Layout Editor</p>
            <h1 className="mt-1 text-3xl font-black text-brand-950">页面布局编辑器</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={isSaving} onClick={() => setWorkingConfig(cloneConfig(layout.draftConfig))} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">撤销未保存</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/reset`, 'POST', '已恢复默认草稿')} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">恢复默认草稿</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/draft`, 'PUT', '草稿已保存')} className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">保存草稿</button>
            <button
              disabled={isSaving}
              onClick={() => {
                if (window.confirm('发布后将立即影响前台页面，确认发布当前草稿吗？')) {
                  submit(`/api/admin/page-layouts/${pageKey}/publish`, 'POST', '布局已发布')
                }
              }}
              className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white"
            >
              发布
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm font-bold text-slate-600 md:grid-cols-4">
          <p>当前版本：{layout.version}</p>
          <p>发布时间：{formatDate(layout.publishedAt)}</p>
          <p>最近修改：{formatDate(layout.updatedAt)}</p>
          <p>当前设备：{device === 'desktop' ? '桌面端' : '移动端'}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {pageOptions.map((item) => (
            <button
              key={item.key}
              onClick={() => setPageKey(item.key)}
              className={`rounded-full px-4 py-2 text-sm font-black ${pageKey === item.key ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}
            >
              {item.label}
            </button>
          ))}
          {(['desktop', 'mobile'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setDevice(item)}
              className={`rounded-full px-4 py-2 text-sm font-black ${device === item ? 'bg-brand-700 text-white' : 'bg-sky-50 text-brand-700'}`}
            >
              {item === 'desktop' ? '桌面端' : '移动端'}
            </button>
          ))}
        </div>

        {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
          <h2 className="text-lg font-black text-brand-950">模块列表</h2>
          <div className="mt-4 grid gap-2">
            {modules.map((item, index) => {
              const definition = findModule(layout.registry, item.key)
              return (
                <button
                  key={item.key}
                  draggable
                  onDragStart={() => setDraggingKey(item.key)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropModule(item.key)}
                  onClick={() => setSelectedKey(item.key)}
                  className={`rounded-2xl border px-3 py-3 text-left transition ${selected?.key === item.key ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white hover:bg-sky-50/70'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-brand-950">{definition?.name || item.key}</span>
                    <span className="text-xs font-black text-slate-400">#{index + 1}</span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">{item.visible ? '显示' : '隐藏'} · {item.width} · {item.gapTop}/{item.gapBottom}</p>
                  <div className="mt-2 flex gap-2">
                    <span role="button" onClick={(event) => { event.stopPropagation(); moveModule(item.key, -1) }} className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">上移</span>
                    <span role="button" onClick={(event) => { event.stopPropagation(); moveModule(item.key, 1) }} className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">下移</span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="min-h-[620px] rounded-[24px] border border-sky-100 bg-sky-50/70 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-brand-950">实时预览</h2>
            <p className="text-xs font-black text-slate-500">预览使用安全占位数据，不写入真实用户数据</p>
          </div>
          <div className={`mx-auto flex flex-wrap gap-x-4 rounded-[22px] bg-white/78 p-4 ${device === 'mobile' ? 'max-w-sm' : 'max-w-6xl'}`}>
            {modules.filter((item) => item.visible).map((item) => {
              const definition = findModule(layout.registry, item.key)
              return (
                <PageLayoutFrame key={item.key} config={item}>
                  <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">{item.key}</p>
                    <h3 className="mt-2 text-xl font-black text-brand-950">{item.title || definition?.name || item.key}</h3>
                    <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                      {item.subtitle || definition?.description || '页面模块预览'}
                    </p>
                    <div className="mt-4 grid gap-2">
                      <div className="h-3 rounded-full bg-sky-100" />
                      <div className="h-3 w-2/3 rounded-full bg-sky-100" />
                    </div>
                  </div>
                </PageLayoutFrame>
              )
            })}
          </div>
        </section>

        <aside className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
          <h2 className="text-lg font-black text-brand-950">属性面板</h2>
          {selected && selectedModule ? (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-black text-brand-950">{selectedModule.name}</p>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{selectedModule.description}</p>
              </div>

              <label className="flex items-center gap-2 text-sm font-black text-slate-600">
                <input type="checkbox" checked={selected.visible} disabled={selectedModule.required} onChange={(event) => updateSelected({ visible: event.target.checked })} />
                显示模块{selectedModule.required ? '（核心模块）' : ''}
              </label>

              <SelectField label="宽度" value={selected.width} options={layoutWidths.filter((item) => selectedModule.allowedWidths.includes(item))} onChange={(value) => updateSelected({ width: value as PageLayoutModuleConfig['width'] })} />
              <SelectField label="上间距" value={selected.gapTop} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} onChange={(value) => updateSelected({ gapTop: value as PageLayoutModuleConfig['gapTop'] })} />
              <SelectField label="下间距" value={selected.gapBottom} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} onChange={(value) => updateSelected({ gapBottom: value as PageLayoutModuleConfig['gapBottom'] })} />
              <SelectField label="对齐" value={selected.alignment} options={layoutAlignments} onChange={(value) => updateSelected({ alignment: value as PageLayoutModuleConfig['alignment'] })} />
              <SelectField label="密度" value={selected.density} options={layoutDensities} onChange={(value) => updateSelected({ density: value as PageLayoutModuleConfig['density'] })} />

              {selectedModule.supportsTitle ? (
                <label className="block">
                  <span className="text-sm font-black text-slate-600">标题</span>
                  <input value={selected.title || ''} maxLength={60} onChange={(event) => updateSelected({ title: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-bold outline-none" />
                </label>
              ) : null}

              {selectedModule.supportsSubtitle ? (
                <label className="block">
                  <span className="text-sm font-black text-slate-600">副标题</span>
                  <textarea value={selected.subtitle || ''} maxLength={160} onChange={(event) => updateSelected({ subtitle: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-bold outline-none" />
                </label>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm font-bold text-slate-500">请选择一个模块。</p>
          )}
        </aside>
      </div>
    </div>
  )
}

function SelectField({
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
      <span className="text-sm font-black text-slate-600">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none">
        {options.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}
