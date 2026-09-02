'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { autoArrangePageLayoutItems, PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { createPageLayoutEditorModules, type LayoutEditorPreviewData } from '@/components/page-layout/LayoutEditorPreviewModules'
import { PAGE_LAYOUT_REGISTRY } from '@/lib/page-layout/registry'
import {
  layoutAlignments,
  layoutDensities,
  layoutSpacings,
  type LayoutWidth,
  type PageLayoutConfig,
  type PageLayoutDevice,
  type PageLayoutGridItem,
  type PageLayoutModuleConfig,
  type PageLayoutModuleDefinition,
  type PageLayoutPageKey,
  type SerializedPageLayout,
  type SerializedPageLayoutRevision,
} from '@/lib/page-layout/types'
type PreviewPayload = LayoutEditorPreviewData & {
  pageKey: PageLayoutPageKey
  generatedAt: string
}
type CheckInPreviewState = 'pending' | 'completed'

const deviceOptions: { key: PageLayoutDevice; label: string; columns: number; viewportWidth: number }[] = [
  { key: 'desktop', label: '桌面端', columns: 12, viewportWidth: 1440 },
  { key: 'tablet', label: '平板端', columns: 8, viewportWidth: 1024 },
  { key: 'mobile', label: '移动端', columns: 4, viewportWidth: 390 },
]

const pageOptions = PAGE_LAYOUT_REGISTRY.map((page) => ({
  key: page.key,
  label: page.name,
  description: page.description,
  path: page.path,
}))

const widthLabels: Record<LayoutWidth, string> = {
  full: '全宽',
  wide: '宽版',
  medium: '中版',
  narrow: '窄版',
  half: '二分之一',
  third: '三分之一',
}

const spacingLabels: Record<string, string> = {
  none: '无间距',
  xs: '紧凑',
  sm: '标准',
  md: '舒适',
  lg: '宽松',
  xl: '超宽松',
}

const alignmentLabels: Record<string, string> = { left: '左对齐', center: '居中', right: '右对齐' }
const densityLabels: Record<string, string> = { compact: '紧凑', normal: '标准', spacious: '宽松' }

function cloneConfig(config: PageLayoutConfig): PageLayoutConfig {
  return {
    desktop: config.desktop.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
    tablet: config.tablet.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
    mobile: config.mobile.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
  }
}

function findModule(registry: PageLayoutModuleDefinition[], key: string) {
  return registry.find((item) => item.key === key) || null
}

function formatDate(value: string | null) {
  if (!value) return '尚未发布'
  return new Date(value).toLocaleString('zh-CN')
}

function formatApiError(data: unknown, fallback: string) {
  if (data && typeof data === 'object') {
    const payload = data as { message?: unknown; errors?: unknown }
    if (payload.errors && typeof payload.errors === 'object') {
      const first = Object.values(payload.errors as Record<string, unknown>).find((value) => typeof value === 'string')
      if (first) return String(first)
    }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  }
  return fallback
}

function widthToColumns(width: LayoutWidth, device: PageLayoutDevice) {
  const columns = device === 'mobile' ? 4 : device === 'tablet' ? 8 : 12
  const ratio = width === 'full' ? 1 : width === 'wide' ? 0.84 : width === 'medium' ? 0.67 : width === 'narrow' ? 0.5 : width === 'half' ? 0.5 : 0.34
  return Math.max(1, Math.min(columns, Math.round(columns * ratio)))
}

function EditorScaleStage({ viewportWidth, children }: Readonly<{ viewportWidth: number; children: ReactNode }>) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [canvasHeight, setCanvasHeight] = useState(0)

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    const updateScale = () => {
      const available = Math.max(280, stage.clientWidth - 32)
      setScale(Math.min(1, available / viewportWidth))
    }
    updateScale()
    const stageObserver = new ResizeObserver(updateScale)
    const canvasObserver = new ResizeObserver((entries) => setCanvasHeight(entries[0]?.contentRect.height || 0))
    stageObserver.observe(stage)
    canvasObserver.observe(canvas)
    return () => {
      stageObserver.disconnect()
      canvasObserver.disconnect()
    }
  }, [viewportWidth])

  return (
    <div ref={stageRef} className="page-layout-editor-stage">
      <div style={{ width: viewportWidth * scale, height: canvasHeight * scale }}>
        <div ref={canvasRef} className="page-layout-editor-scale" style={{ width: viewportWidth, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export function LayoutEditorClient({
  initialPage,
  initialLayout,
  initialPreviewData = null,
  initialRevisions = [],
}: {
  initialPage: PageLayoutPageKey
  initialLayout?: SerializedPageLayout
  initialPreviewData?: PreviewPayload | null
  initialRevisions?: SerializedPageLayoutRevision[]
}) {
  const initialLayoutRef = useRef(initialLayout)
  const initialAsyncPageRef = useRef<PageLayoutPageKey | null>(initialPage)
  const [pageKey, setPageKeyState] = useState<PageLayoutPageKey>(initialPage)
  const [device, setDevice] = useState<PageLayoutDevice>('desktop')
  const [layout, setLayout] = useState<SerializedPageLayout | null>(initialLayout || null)
  const [workingConfig, setWorkingConfig] = useState<PageLayoutConfig | null>(() => initialLayout ? cloneConfig(initialLayout.draftConfig) : null)
  const [previewData, setPreviewData] = useState<PreviewPayload | null>(initialPreviewData)
  const [revisions, setRevisions] = useState<SerializedPageLayoutRevision[]>(initialRevisions)
  const [selectedRevision, setSelectedRevision] = useState<SerializedPageLayoutRevision | null>(null)
  const [selectedKey, setSelectedKey] = useState(() => initialLayout?.draftConfig.desktop?.[0]?.key || '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [checkInPreviewState, setCheckInPreviewState] = useState<CheckInPreviewState>('pending')

  function loadRevisions(nextPageKey: PageLayoutPageKey) {
    fetch(`/api/admin/page-layouts/${nextPageKey}/revisions?limit=20`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.message || '加载版本历史失败')
        setRevisions(data.revisions || [])
      })
      .catch(() => setRevisions([]))
  }

  useEffect(() => {
    let cancelled = false
    setMessage('')
    setError('')
    setSelectedRevision(null)
    setIsDirty(false)
    setCheckInPreviewState('pending')
    const shouldFetchAsyncData = initialAsyncPageRef.current !== pageKey
    initialAsyncPageRef.current = null
    const shouldFetchLayout = initialLayoutRef.current?.pageKey !== pageKey
    initialLayoutRef.current = undefined

    if (shouldFetchLayout) {
      setLayout(null)
      setWorkingConfig(null)
      fetch(`/api/admin/page-layouts/${pageKey}`)
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (cancelled) return
          if (!ok) throw new Error(data?.message || '加载布局失败')
          setLayout(data)
          setWorkingConfig(cloneConfig(data.draftConfig))
          setSelectedKey(data.draftConfig.desktop?.[0]?.key || '')
        })
        .catch((loadError) => {
          if (!cancelled) setError(loadError instanceof Error ? loadError.message : '加载布局失败')
        })
    }

    if (shouldFetchAsyncData) {
      setPreviewData(null)
      fetch(`/api/admin/page-layouts/${pageKey}/preview`)
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (cancelled) return
          if (!ok) throw new Error(data?.message || '加载预览数据失败')
          setPreviewData(data)
        })
        .catch(() => {
          if (!cancelled) setPreviewData(null)
        })
      fetch(`/api/admin/page-layouts/${pageKey}/revisions?limit=20`)
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (cancelled) return
          if (!ok) throw new Error(data?.message || '加载版本历史失败')
          setRevisions(data.revisions || [])
        })
        .catch(() => {
          if (!cancelled) setRevisions([])
        })
    }

    return () => {
      cancelled = true
    }
  }, [pageKey])

  const previewConfig = selectedRevision?.config || workingConfig
  const modules = useMemo(() => {
    if (!previewConfig) return []
    const knownKeys = new Set((layout?.registry || []).map((definition) => definition.key))
    return [...previewConfig[device]]
      .filter((item) => knownKeys.has(item.key))
      .sort((a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order)
  }, [device, layout?.registry, previewConfig])
  const activeModules = useMemo(() => modules.filter((item) => item.visible && !item.isHidden), [modules])
  const hiddenModules = useMemo(() => modules.filter((item) => !item.visible || item.isHidden), [modules])
  const selected = modules.find((item) => item.key === selectedKey) || modules[0]
  const selectedModule = selected ? findModule(layout?.registry || [], selected.key) : null
  const pageMeta = pageOptions.find((item) => item.key === pageKey) || pageOptions[0]
  const deviceMeta = deviceOptions.find((item) => item.key === device) || deviceOptions[0]
  const readOnly = Boolean(selectedRevision)

  const unplacedModules = useMemo(() => {
    const present = new Set(modules.map((item) => item.key))
    return (layout?.registry || []).filter((definition) => !present.has(definition.key))
  }, [layout?.registry, modules])

  useEffect(() => {
    if (modules.length && !modules.some((item) => item.key === selectedKey)) setSelectedKey(modules[0].key)
  }, [modules, selectedKey])

  function setPageKey(nextPageKey: PageLayoutPageKey) {
    if (nextPageKey === pageKey) return
    if (isDirty && !window.confirm('当前草稿有未保存修改，切换页面会丢失这些本地修改。继续切换吗？')) return
    const url = new URL(window.location.href)
    url.searchParams.set('page', nextPageKey)
    window.history.pushState(null, '', `${url.pathname}?${url.searchParams.toString()}`)
    setPageKeyState(nextPageKey)
  }

  function updateDeviceItems(updater: (items: PageLayoutModuleConfig[]) => PageLayoutModuleConfig[]) {
    if (readOnly) return
    setSelectedRevision(null)
    setIsDirty(true)
    setWorkingConfig((current) => current ? { ...current, [device]: updater([...current[device]]) } : current)
  }

  function updateAutoHeight(key: string, nextH: number) {
    if (readOnly) return
    setIsDirty(true)
    setWorkingConfig((current) => {
      if (!current) return current
      const item = current[device].find((candidate) => candidate.key === key)
      if (!item || nextH === item.grid[device].h) return current
      return {
        ...current,
        [device]: current[device].map((candidate) => candidate.key === key
          ? { ...candidate, grid: { ...candidate.grid, [device]: { ...candidate.grid[device], h: nextH } } }
          : candidate),
      }
    })
  }

  function updateSelected(patch: Partial<PageLayoutModuleConfig>) {
    if (!selected || readOnly) return
    updateDeviceItems((items) => items.map((item) => (item.key === selected.key ? { ...item, ...patch } : item)))
  }

  function updateSelectedGrid(patch: Partial<PageLayoutGridItem>) {
    if (!selected || readOnly) return
    updateDeviceItems((items) => items.map((item) => item.key === selected.key
      ? { ...item, grid: { ...item.grid, [device]: { ...item.grid[device], ...patch } } }
      : item))
  }

  function updateSelectedWidth(value: string) {
    if (!selected) return
    const width = value as LayoutWidth
    const columns = deviceMeta.columns
    const nextWidth = Math.min(columns, widthToColumns(width, device))
    updateDeviceItems((items) => items.map((item) => item.key === selected.key
      ? { ...item, width, grid: { ...item.grid, [device]: { ...item.grid[device], x: Math.min(item.grid[device].x, Math.max(0, columns - nextWidth)), w: nextWidth } } }
      : item))
  }

  function addModule(definition: PageLayoutModuleDefinition) {
    if (readOnly || !workingConfig) return
    const defaultItem = workingConfig[device].find((item) => item.key === definition.key)
      || layout?.defaults[device].find((item) => item.key === definition.key)
    if (!defaultItem) return
    setSelectedKey(definition.key)
    updateDeviceItems((items) => [...items, { ...defaultItem, visible: true, isHidden: false }])
  }

  function cleanLegacyModules() {
    if (readOnly || !layout?.warnings.length) return
    const knownKeys = new Set(layout.registry.map((definition) => definition.key))
    setWorkingConfig((current) => {
      if (!current) return current
      return {
        desktop: current.desktop.filter((item) => knownKeys.has(item.key)),
        tablet: current.tablet.filter((item) => knownKeys.has(item.key)),
        mobile: current.mobile.filter((item) => knownKeys.has(item.key)),
      }
    })
    setSelectedRevision(null)
    setIsDirty(true)
    setMessage('旧模块已从当前画布中安全移除，保存草稿后完成清理。')
  }

  async function submit(url: string, method: 'PUT' | 'POST', successMessage: string, config = workingConfig) {
    if (!layout || !config) return
    setIsSaving(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: layout.version, config }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(formatApiError(data, '操作失败'))
        return
      }
      setLayout(data)
      setWorkingConfig(cloneConfig(data.draftConfig))
      setSelectedRevision(null)
      setIsDirty(false)
      setMessage(data.message || successMessage)
      loadRevisions(pageKey)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '操作失败')
    } finally {
      setIsSaving(false)
    }
  }

  async function restoreRevision(revision: SerializedPageLayoutRevision, publish: boolean) {
    if (!layout) return
    const confirmed = window.confirm(publish ? `确认将 v${revision.version} 恢复并发布为新版本吗？` : `确认将 v${revision.version} 恢复到草稿吗？`)
    if (!confirmed) return
    await submit(
      `/api/admin/page-layouts/${pageKey}/revisions/${revision.id}/${publish ? 'publish' : 'restore-draft'}`,
      'POST',
      publish ? '历史版本已恢复并发布' : '历史版本已恢复为草稿',
      revision.config,
    )
  }

  if (!workingConfig || !layout || !previewConfig) {
    return <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm font-black text-slate-600 shadow-sm">{error || '正在加载真实页面布局…'}</section>
  }

  const editorPreviewModules = createPageLayoutEditorModules({ pageKey, previewConfig, previewData, checkInPreviewState })

  const currentGrid = selected?.grid[device]

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">后台管理 / 页面布局</p>
            <h1 className="mt-1 text-3xl font-black text-brand-950">页面布局编辑器</h1>
            <p className="mt-2 text-sm font-bold text-slate-500">{pageMeta.description} · 前台与编辑器共用真实组件和同一份布局数据。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={isSaving || !isDirty} onClick={() => { setWorkingConfig(cloneConfig(layout.draftConfig)); setSelectedRevision(null); setIsDirty(false) }} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50">撤销未保存</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/reset`, 'POST', '已恢复默认草稿', layout.defaults)} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-brand-700">恢复默认草稿</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/draft`, 'PUT', '草稿已保存')} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-black text-white">保存草稿</button>
            <button disabled={isSaving} onClick={() => { if (window.confirm('发布后将立即影响前台页面，确认发布当前草稿吗？')) void submit(`/api/admin/page-layouts/${pageKey}/publish`, 'POST', '布局已发布') }} className="rounded-md bg-brand-950 px-4 py-2 text-sm font-black text-white">发布</button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm font-bold text-slate-600 md:grid-cols-4">
          <p>当前版本：{layout.version}{isDirty ? '（本地未保存）' : ''}</p>
          <p>发布时间：{formatDate(layout.publishedAt)}</p>
          <p>最近修改：{formatDate(layout.updatedAt)}</p>
          <p>当前设备：{deviceMeta.label} {deviceMeta.columns} 列</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {pageOptions.map((item) => <button key={item.key} onClick={() => setPageKey(item.key)} className={`rounded-md px-4 py-2 text-sm font-black ${pageKey === item.key ? 'bg-brand-950 text-white' : 'border border-slate-200 bg-slate-50 text-brand-700'}`}>{item.label}</button>)}
          {deviceOptions.map((item) => <button key={item.key} onClick={() => setDevice(item.key)} className={`rounded-md px-4 py-2 text-sm font-black ${device === item.key ? 'bg-brand-700 text-white' : 'border border-slate-200 bg-slate-50 text-brand-700'}`}>{item.label}</button>)}
          <Link href={pageMeta.path} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-brand-700 shadow-sm">查看前台</Link>
        </div>

        {message ? <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}
        {layout.warnings.length ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-black">发现 {layout.warnings.length} 个旧布局模块</p>
                <p className="mt-1 text-xs font-bold leading-5 text-amber-800">这些模块不会进入画布或前台；点击清理后保存草稿即可从当前布局中移除。</p>
              </div>
              <button type="button" disabled={readOnly} onClick={cleanLegacyModules} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-900 disabled:cursor-not-allowed disabled:opacity-50">清理旧模块</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-black text-amber-800">
              {layout.warnings.map((warning) => <span key={`${warning.device}:${warning.key}`} className="rounded border border-amber-200 bg-white/70 px-2 py-1">{warning.key} · {warning.device === 'desktop' ? '桌面' : warning.device === 'tablet' ? '平板' : '移动'} · {warning.kind === 'DEPRECATED' ? '已废弃' : '未知'}</span>)}
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black text-brand-950">页面结构</h2>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">模块名称、顺序和隐藏状态来自真实前台 Registry；点击画布中的模块即可编辑。</p>
          <div className="mt-4 grid gap-2">
            {activeModules.map((item, index) => {
              const definition = findModule(layout.registry, item.key)
              return <ModuleListButton key={item.key} item={item} definition={definition} index={index} selected={selected?.key === item.key} hidden={false} onClick={() => { setSelectedKey(item.key); setSelectedRevision(null) }} />
            })}
          </div>
          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-black text-brand-950">已隐藏模块</h3>
            <div className="mt-3 grid gap-2">
              {hiddenModules.map((item) => {
                const definition = findModule(layout.registry, item.key)
                return <ModuleListButton key={item.key} item={item} definition={definition} selected={selected?.key === item.key} hidden onClick={() => { setSelectedKey(item.key); setSelectedRevision(null) }} />
              })}
              {!hiddenModules.length ? <p className="rounded-md bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">当前设备没有隐藏模块。</p> : null}
            </div>
          </div>
          {unplacedModules.length ? (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-black text-brand-950">可添加模块</h3>
              <div className="mt-3 grid gap-2">
                {unplacedModules.map((definition) => <button key={definition.key} type="button" disabled={readOnly} onClick={() => addModule(definition)} className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-left text-xs font-black text-brand-700 disabled:opacity-50">＋ {definition.name}</button>)}
              </div>
            </div>
          ) : null}
        </aside>

        <section className="min-h-[620px] rounded-lg border border-slate-200 bg-slate-100 p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-brand-950">真实页面画布</h2>
              <p className="mt-1 text-xs font-black text-slate-500">{selectedRevision ? `正在预览历史版本 v${selectedRevision.version}` : '画布使用真实前台组件；拖动模块调整位置，拖动边缘调整宽高。'} </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {pageKey === 'checkin' ? <div className="flex rounded-md border border-slate-200 bg-white p-1 shadow-sm" aria-label="每日挂号状态预览"><button type="button" onClick={() => setCheckInPreviewState('pending')} className={`rounded-md px-3 py-1.5 text-xs font-black ${checkInPreviewState === 'pending' ? 'bg-brand-700 text-white' : 'text-brand-700'}`}>未挂号预览</button><button type="button" onClick={() => setCheckInPreviewState('completed')} className={`rounded-md px-3 py-1.5 text-xs font-black ${checkInPreviewState === 'completed' ? 'bg-brand-700 text-white' : 'text-brand-700'}`}>已挂号预览</button></div> : null}
              {selectedRevision ? <button onClick={() => setSelectedRevision(null)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-brand-700">返回草稿预览</button> : null}
              <button disabled={readOnly} onClick={() => updateDeviceItems((items) => autoArrangePageLayoutItems(pageKey, items, device))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-50">自动整理</button>
            </div>
          </div>
          <EditorScaleStage viewportWidth={deviceMeta.viewportWidth}>
            <PageLayoutRenderer
              pageKey={pageKey}
              config={previewConfig}
              modules={editorPreviewModules}
              device={device}
              mode="editor"
              selectedKey={selected?.key || ''}
              readOnly={readOnly}
              onSelect={(key) => { setSelectedKey(key); setSelectedRevision(null) }}
              onChange={(items) => updateDeviceItems(() => items)}
              onAutoHeightChange={updateAutoHeight}
              viewportWidth={deviceMeta.viewportWidth}
            />
          </EditorScaleStage>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-black text-brand-950">属性面板</h2>
            {selected && selectedModule && currentGrid ? (
              <div className="mt-4 space-y-4">
                <div><p className="text-sm font-black text-brand-950">{selectedModule.name}</p><p className="mt-1 text-xs font-bold leading-5 text-slate-500">{selectedModule.description}</p></div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-black leading-6 text-slate-600"><p>高度：{selectedModule.heightMode === 'AUTO' ? '自动撑开' : '固定高度'}</p><p>当前设备：{deviceMeta.label} · {deviceMeta.columns} 列网格</p></div>
                <div className="flex items-center justify-between gap-3"><span className="text-sm font-black text-slate-600">显示状态</span><button type="button" disabled={selectedModule.core || !selectedModule.hideable || readOnly} onClick={() => updateSelected({ visible: selected.isHidden, isHidden: !selected.isHidden })} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{selected.isHidden ? '显示模块' : '隐藏模块'}</button></div>
                <label className="flex items-center gap-2 text-sm font-black text-slate-600"><input type="checkbox" checked={!selected.isHidden} disabled={selectedModule.core || !selectedModule.hideable || readOnly} onChange={(event) => updateSelected({ visible: event.target.checked, isHidden: !event.target.checked })} />显示模块{selectedModule.core ? '（核心模块）' : ''}</label>
                <SelectField label="版式宽度" value={selected.width} options={selectedModule.allowedWidths} labels={widthLabels} disabled={readOnly} onChange={updateSelectedWidth} />
                <SelectField label="上间距" value={selected.gapTop} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} labels={spacingLabels} disabled={readOnly} onChange={(value) => updateSelected({ gapTop: value as PageLayoutModuleConfig['gapTop'] })} />
                <SelectField label="下间距" value={selected.gapBottom} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} labels={spacingLabels} disabled={readOnly} onChange={(value) => updateSelected({ gapBottom: value as PageLayoutModuleConfig['gapBottom'] })} />
                <SelectField label="对齐方式" value={selected.alignment} options={layoutAlignments} labels={alignmentLabels} disabled={readOnly} onChange={(value) => updateSelected({ alignment: value as PageLayoutModuleConfig['alignment'] })} />
                <SelectField label="内容密度" value={selected.density} options={layoutDensities} labels={densityLabels} disabled={readOnly} onChange={(value) => updateSelected({ density: value as PageLayoutModuleConfig['density'] })} />
                {selectedModule.supportsTitle ? <label className="block"><span className="text-sm font-black text-slate-600">自定义标题</span><input disabled={readOnly} value={selected.title || ''} maxLength={60} onChange={(event) => updateSelected({ title: event.target.value })} className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-bold outline-none disabled:bg-slate-50" /></label> : null}
                {selectedModule.supportsSubtitle ? <label className="block"><span className="text-sm font-black text-slate-600">自定义副标题</span><textarea disabled={readOnly} value={selected.subtitle || ''} maxLength={160} onChange={(event) => updateSelected({ subtitle: event.target.value })} className="mt-2 min-h-24 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-bold outline-none disabled:bg-slate-50" /></label> : null}
                <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3"><summary className="cursor-pointer text-xs font-black text-slate-600">高级网格参数 x / y / w / h</summary><div className="mt-3 grid grid-cols-2 gap-2">{(['x', 'y', 'w', 'h'] as const).map((key) => <label key={key} className="text-xs font-black text-slate-500">{key.toUpperCase()}<input type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={key === 'w' ? deviceMeta.columns : key === 'h' ? 40 : 200} value={currentGrid[key]} disabled={readOnly} onChange={(event) => updateSelectedGrid({ [key]: Number(event.target.value) || 0 })} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm font-black text-brand-950 disabled:bg-slate-100" /></label>)}</div></details>
              </div>
            ) : <p className="mt-4 text-sm font-bold text-slate-500">请选择一个模块。</p>}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-black text-brand-950">版本历史</h2><div className="mt-4 grid gap-2">{revisions.map((revision) => <div key={revision.id} className={`rounded-md border p-3 ${selectedRevision?.id === revision.id ? 'border-brand-700 bg-slate-50' : 'border-slate-200 bg-white'}`}><div className="flex items-center justify-between gap-2"><p className="text-sm font-black text-brand-950">v{revision.version} · {revision.source}</p><button onClick={() => setSelectedRevision(revision)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-black text-brand-700">预览</button></div><p className="mt-1 text-xs font-bold text-slate-500">{formatDate(revision.createdAt)} · {revision.publishedByName || '未知管理员'}</p>{revision.note ? <p className="mt-1 text-xs font-bold text-slate-500">{revision.note}</p> : null}<div className="mt-2 flex flex-wrap gap-2"><button disabled={isSaving} onClick={() => void restoreRevision(revision, false)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-brand-700">恢复到草稿</button><button disabled={isSaving} onClick={() => void restoreRevision(revision, true)} className="rounded-md bg-brand-950 px-3 py-1.5 text-xs font-black text-white">恢复并发布</button></div></div>)}{!revisions.length ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-slate-500">暂无发布历史，首次发布后会生成版本记录。</p> : null}</div></section>
        </aside>
      </div>
    </div>
  )
}

function ModuleListButton({ item, definition, index, selected, hidden, onClick }: Readonly<{ item: PageLayoutModuleConfig; definition: PageLayoutModuleDefinition | null; index?: number; selected: boolean; hidden: boolean; onClick: () => void }>) {
  return <button type="button" onClick={onClick} className={`rounded-md border px-3 py-3 text-left transition ${selected ? 'border-brand-700 bg-slate-50' : hidden ? 'border-slate-200 bg-slate-50 hover:bg-slate-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className={`flex min-w-0 items-center gap-2 text-sm font-black ${hidden ? 'text-slate-600' : 'text-brand-950'}`}><span aria-hidden="true" className="text-base">{hidden ? '◌' : '◉'}</span>{definition?.name || item.key}</span><span className="text-xs font-black text-slate-400">{hidden ? '已隐藏' : `第 ${(index || 0) + 1} 项`}</span></div><p className="mt-1 text-xs font-bold text-slate-500">{definition?.category || '页面模块'} · {definition?.heightMode === 'FIXED' ? '固定高度' : '自动高度'}</p></button>
}

function SelectField({ label, value, options, labels, disabled, onChange }: Readonly<{ label: string; value: string; options: readonly string[]; labels: Record<string, string>; disabled?: boolean; onChange: (value: string) => void }>) {
  return <label className="block"><span className="text-sm font-black text-slate-600">{label}</span><select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none disabled:bg-slate-50">{options.map((item) => <option key={item} value={item}>{labels[item] || item}</option>)}</select></label>
}
