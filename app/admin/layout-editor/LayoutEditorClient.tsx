'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageLayoutCanvasEditor, type PageLayoutCanvasModules } from '@/components/page-layout/PageLayoutCanvasEditor'
import { createCheckInLayoutModules, type TodayCheckInPayload } from '@/components/CheckInLayoutSurface'
import type { CheckInMessageItem } from '@/lib/checkin-messages'
import { pageLayoutPages } from '@/lib/page-layout/registry'
import {
  layoutAlignments,
  layoutDensities,
  layoutSpacings,
  type PageLayoutConfig,
  type PageLayoutDevice,
  type PageLayoutGridItem,
  type PageLayoutModuleConfig,
  type PageLayoutModuleDefinition,
  type PageLayoutPageKey,
  type SerializedPageLayout,
  type SerializedPageLayoutRevision,
} from '@/lib/page-layout/types'

type PreviewModulePayload = { ok: true; data: unknown } | { ok: false; message: string }
type PreviewPayload = {
  pageKey: PageLayoutPageKey
  generatedAt: string
  modules: Record<string, PreviewModulePayload>
}
type CheckInPreviewState = 'pending' | 'completed'

const deviceOptions: { key: PageLayoutDevice; label: string; columns: number }[] = [
  { key: 'desktop', label: '桌面端', columns: 12 },
  { key: 'tablet', label: '平板端', columns: 8 },
  { key: 'mobile', label: '移动端', columns: 4 },
]

const pageOptions = Object.entries(pageLayoutPages).map(([key, page]) => ({
  key: key as PageLayoutPageKey,
  label: page.name,
  path: page.path,
}))

function cloneConfig(config: PageLayoutConfig): PageLayoutConfig {
  return {
    desktop: config.desktop.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
    tablet: config.tablet.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
    mobile: config.mobile.map((item) => ({ ...item, grid: { desktop: { ...item.grid.desktop }, tablet: { ...item.grid.tablet }, mobile: { ...item.grid.mobile } } })),
  }
}

function columnsFor(device: PageLayoutDevice) {
  return device === 'desktop' ? 12 : device === 'tablet' ? 8 : 4
}

function findModule(registry: PageLayoutModuleDefinition[], key: string) {
  return registry.find((item) => item.key === key)
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

function fits(grid: PageLayoutGridItem, occupied: Set<string>, columns: number) {
  if (grid.x < 0 || grid.x + grid.w > columns) return false
  for (let y = grid.y; y < grid.y + grid.h; y += 1) {
    for (let x = grid.x; x < grid.x + grid.w; x += 1) {
      if (occupied.has(`${x}:${y}`)) return false
    }
  }
  return true
}

function occupy(grid: PageLayoutGridItem, occupied: Set<string>) {
  for (let y = grid.y; y < grid.y + grid.h; y += 1) {
    for (let x = grid.x; x < grid.x + grid.w; x += 1) {
      occupied.add(`${x}:${y}`)
    }
  }
}

function compactItems(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  const columns = columnsFor(device)
  const occupied = new Set<string>()
  return [...items]
    .sort((a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order)
    .map((item, index) => {
      const base = item.grid[device]
      const nextGrid = { ...base, x: Math.min(base.x, Math.max(0, columns - base.w)), y: 0 }
      let placed = false
      for (let y = 0; y < 200 && !placed; y += 1) {
        for (let x = 0; x <= columns - nextGrid.w; x += 1) {
          const candidate = { ...nextGrid, x, y }
          if (fits(candidate, occupied, columns)) {
            nextGrid.x = x
            nextGrid.y = y
            placed = true
            break
          }
        }
      }
      occupy(nextGrid, occupied)
      return {
        ...item,
        order: (index + 1) * 10,
        grid: { ...item.grid, [device]: nextGrid },
      }
    })
}

function readObject(data: unknown) {
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

function readNumber(data: Record<string, unknown>, key: string, fallback = 0) {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readString(data: Record<string, unknown>, key: string, fallback = '') {
  return typeof data[key] === 'string' ? data[key] : fallback
}

function readTodayCheckIn(data: unknown): TodayCheckInPayload {
  const item = readObject(data)
  if (!readString(item, 'checkDate') || !readString(item, 'createdAt')) return null
  return {
    checkDate: readString(item, 'checkDate'),
    points: readNumber(item, 'points'),
    exp: readNumber(item, 'exp'),
    mood: typeof item.mood === 'string' ? item.mood : null,
    message: typeof item.message === 'string' ? item.message : null,
    streakDay: readNumber(item, 'streakDay'),
    createdAt: readString(item, 'createdAt'),
  }
}

function readCheckInMessages(data: unknown): CheckInMessageItem[] {
  if (!Array.isArray(data)) return []
  return data.filter((item): item is CheckInMessageItem => {
    const value = readObject(item)
    const user = readObject(value.user)
    return typeof value.id === 'string' && typeof value.content === 'string' && typeof value.createdAt === 'string'
      && typeof user.uid === 'string' && typeof user.nickname === 'string'
      && Array.isArray(value.comments) && Array.isArray(value.likes) && Array.isArray(value.favorites)
  })
}

function renderPreviewContent(item: PageLayoutModuleConfig, definition: PageLayoutModuleDefinition | undefined, payload: PreviewModulePayload | null, device: PageLayoutDevice) {
  const title = item.title || definition?.name || item.key
  const subtitle = item.subtitle || definition?.description
  const data = payload?.ok ? readObject(payload.data) : {}
  const grid = item.grid[device]
  const columns = columnsFor(device)

  return (
    <div className="layout-card h-full min-h-28 rounded-2xl border border-sky-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">{item.key}</p>
        <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-black text-brand-700">
          {grid.w}/{columns}
        </span>
      </div>
      <h3 className="mt-2 text-xl font-black text-brand-950">{title}</h3>
      {subtitle ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{subtitle}</p> : null}
      {payload?.ok === false ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">{payload.message}</p> : null}
      {payload?.ok === true && Object.keys(data).length ? <p className="mt-3 text-xs font-bold text-slate-400">预览数据已加载</p> : null}
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
  const modules = useMemo(
    () => (workingConfig ? [...workingConfig[device]].sort((a, b) => a.grid[device].y - b.grid[device].y || a.grid[device].x - b.grid[device].x || a.order - b.order) : []),
    [workingConfig, device],
  )
  const activeModules = useMemo(() => modules.filter((item) => item.visible && !item.isHidden), [modules])
  const hiddenModules = useMemo(() => modules.filter((item) => item.isHidden), [modules])
  const selected = modules.find((item) => item.key === selectedKey) || modules[0]
  const selectedModule = selected ? findModule(layout?.registry || [], selected.key) : null

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
    setSelectedRevision(null)
    setIsDirty(true)
    setWorkingConfig((current) => current ? { ...current, [device]: updater([...current[device]]) } : current)
  }

  function updateAutoHeight(key: string, nextH: number) {
    if (selectedRevision) return
    setIsDirty(true)
    setWorkingConfig((current) => {
      if (!current) return current
      const item = current[device].find((candidate) => candidate.key === key)
      if (!item || nextH === item.grid[device].h) return current
      return {
        ...current,
        [device]: current[device].map((candidate) => candidate.key === key
          ? {
              ...candidate,
              grid: {
                ...candidate.grid,
                [device]: {
                  ...candidate.grid[device],
                  h: nextH,
                },
              },
            }
          : candidate),
      }
    })
  }

  function updateSelected(patch: Partial<PageLayoutModuleConfig>) {
    if (!selected) return
    updateDeviceItems((items) => items.map((item) => (item.key === selected.key ? { ...item, ...patch } : item)))
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
      setError(data?.message || '操作失败')
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
    return (
      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-6 text-sm font-black text-slate-600 shadow-sm">
        {error || '正在加载 Visual Layout Editor v2 Final...'}
      </section>
    )
  }

let rendererModules: PageLayoutCanvasModules

if (pageKey === 'checkin') {
  const headerData =
    previewData?.modules?.['checkin.header']?.ok
      ? readObject(previewData.modules['checkin.header'].data)
      : {}

  const statsData = readObject(headerData.stats)
  const userStatsData = readObject(headerData.userStats)
  const loadedTodayCheckIn = readTodayCheckIn(headerData.todayCheckIn)
  const todayValue = readString(headerData, 'today', new Date().toISOString().slice(0, 10))
  const previewTodayCheckIn: TodayCheckInPayload = checkInPreviewState === 'completed'
    ? loadedTodayCheckIn || {
        checkDate: todayValue,
        points: 10,
        exp: 5,
        mood: 'happy',
        message: '今天也要好好生活，明天继续来私家E院报到。',
        streakDay: Math.max(1, readNumber(userStatsData, 'consecutiveDays')),
        createdAt: new Date().toISOString(),
      }
    : null

  const messagesData: CheckInMessageItem[] =
    previewData?.modules?.['checkin.publicMessages']?.ok
      ? readCheckInMessages(previewData.modules['checkin.publicMessages'].data)
      : []
  const friendMessagesData: CheckInMessageItem[] =
    previewData?.modules?.['checkin.friendMessages']?.ok
      ? readCheckInMessages(previewData.modules['checkin.friendMessages'].data)
      : []

  rendererModules = createCheckInLayoutModules({
    layoutConfig: previewConfig,
    dailyQuote: readString(headerData, 'quote'),
    activeUsers: readNumber(statsData, 'activeUsers'),
    todayCount: readNumber(statsData, 'todayCount'),
    consecutiveDays: readNumber(userStatsData, 'consecutiveDays'),
    totalCheckIns: readNumber(statsData, 'totalCheckIns'),
    moodIndex: 0,
    todayCheckIn: previewTodayCheckIn,
    selectedMessages: messagesData,
    friendMessages: friendMessagesData,
    selectedDateValue: todayValue,
    todayValue,
    sort: 'latest',
    sessionUserId: '',
    sessionUserRole: 'USER',
    stats: {
      level: readNumber(userStatsData, 'level', 1),
      points: readNumber(userStatsData, 'points'),
      exp: readNumber(userStatsData, 'exp'),
      consecutiveDays: readNumber(userStatsData, 'consecutiveDays'),
    },
    previewMode: true,
  })
} else {
  rendererModules = Object.fromEntries(
    previewConfig[device].map((item) => {
      const definition = findModule(layout.registry, item.key)
       return [
         item.key,
         () => renderPreviewContent(
           item,
           definition,
           previewData?.modules?.[item.key] || null,
           device,
         ),
      ]
    }),
  )
}
  const pageMeta = pageLayoutPages[pageKey]
  const grid = selected?.grid[device]
  const deviceMeta = deviceOptions.find((item) => item.key === device)

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Visual Layout Editor v2 Final</p>
            <h1 className="mt-1 text-3xl font-black text-brand-950">页面布局编辑器</h1>
            <p className="mt-2 text-sm font-bold text-slate-500">{pageMeta.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={isSaving || !isDirty} onClick={() => { setWorkingConfig(cloneConfig(layout.draftConfig)); setSelectedRevision(null); setIsDirty(false) }} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50">撤销未保存</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/reset`, 'POST', '已恢复默认草稿', layout.defaults)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">恢复默认草稿</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/draft`, 'PUT', '草稿已保存')} className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">保存草稿</button>
            <button disabled={isSaving} onClick={() => { if (window.confirm('发布后将立即影响前台页面，确认发布当前草稿吗？')) submit(`/api/admin/page-layouts/${pageKey}/publish`, 'POST', '布局已发布') }} className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white">发布</button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm font-bold text-slate-600 md:grid-cols-4">
          <p>当前版本：{layout.version}{isDirty ? '（本地未保存）' : ''}</p>
          <p>发布时间：{formatDate(layout.publishedAt)}</p>
          <p>最近修改：{formatDate(layout.updatedAt)}</p>
          <p>当前设备：{deviceMeta?.label} {deviceMeta?.columns} 列</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {pageOptions.map((item) => (
            <button key={item.key} onClick={() => setPageKey(item.key)} className={`rounded-full px-4 py-2 text-sm font-black ${pageKey === item.key ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{item.label}</button>
          ))}
          {deviceOptions.map((item) => (
            <button key={item.key} onClick={() => setDevice(item.key)} className={`rounded-full px-4 py-2 text-sm font-black ${device === item.key ? 'bg-brand-700 text-white' : 'bg-sky-50 text-brand-700'}`}>{item.label}</button>
          ))}
          <Link href={pageMeta.path} className="rounded-full bg-white px-4 py-2 text-sm font-black text-brand-700 shadow-sm">查看前台</Link>
        </div>

        {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
          <h2 className="text-lg font-black text-brand-950">模块列表</h2>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">列表用于选择模块；位置和尺寸请在画布中直接拖动或缩放。</p>
          <div className="mt-4 grid gap-2">
            {activeModules.map((item, index) => {
              const definition = findModule(layout.registry, item.key)
              const currentGrid = item.grid[device]
              return (
                <button
                  key={item.key}
                  onClick={() => { setSelectedKey(item.key); setSelectedRevision(null) }}
                  className={`rounded-2xl border px-3 py-3 text-left transition ${selected?.key === item.key ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white hover:bg-sky-50/70'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-brand-950">{definition?.name || item.key}</span>
                    <span className="text-xs font-black text-slate-400">#{index + 1}</span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">{item.visible ? '显示' : '隐藏'} · x{currentGrid.x} y{currentGrid.y} · {currentGrid.w}x{currentGrid.h}</p>
                </button>
              )
            })}
          </div>
          <div className="mt-6 border-t border-sky-100 pt-4">
            <h3 className="text-sm font-black text-brand-950">已隐藏模块</h3>
            <div className="mt-3 grid gap-2">
              {hiddenModules.map((item) => {
                const definition = findModule(layout.registry, item.key)
                const currentGrid = item.grid[device]
                return (
                  <button
                    key={item.key}
                    onClick={() => { setSelectedKey(item.key); setSelectedRevision(null) }}
                    className={`rounded-2xl border px-3 py-3 text-left transition ${selected?.key === item.key ? 'border-slate-500 bg-slate-100' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-slate-600">{definition?.name || item.key}</span>
                      <span className="text-xs font-black text-slate-400">隐藏</span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-slate-500">x{currentGrid.x} y{currentGrid.y} · {currentGrid.w}x{currentGrid.h}</p>
                  </button>
                )
              })}
              {!hiddenModules.length ? <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-slate-500">当前设备没有隐藏模块。</p> : null}
            </div>
          </div>
        </aside>

        <section className="min-h-[620px] rounded-[24px] border border-sky-100 bg-sky-50/70 p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-brand-950">Canvas 画布</h2>
              <p className="mt-1 text-xs font-black text-slate-500">{selectedRevision ? `正在预览历史版本 v${selectedRevision.version}` : '拖动模块调整位置，拖拉边缘调整宽高'} · 正式页仍共用 PageLayoutRenderer</p>
            </div>
            <div className="flex gap-2">
              {pageKey === 'checkin' ? (
                <div className="flex rounded-full bg-white p-1 shadow-sm" aria-label="每日挂号状态预览">
                  <button
                    type="button"
                    onClick={() => setCheckInPreviewState('pending')}
                    className={`rounded-full px-3 py-1.5 text-xs font-black ${checkInPreviewState === 'pending' ? 'bg-brand-700 text-white' : 'text-brand-700'}`}
                  >未挂号预览</button>
                  <button
                    type="button"
                    onClick={() => setCheckInPreviewState('completed')}
                    className={`rounded-full px-3 py-1.5 text-xs font-black ${checkInPreviewState === 'completed' ? 'bg-brand-700 text-white' : 'text-brand-700'}`}
                  >已挂号预览</button>
                </div>
              ) : null}
              {selectedRevision ? <button onClick={() => setSelectedRevision(null)} className="rounded-full bg-white px-3 py-2 text-xs font-black text-brand-700">返回草稿预览</button> : null}
              <button onClick={() => updateDeviceItems((items) => compactItems(items, device))} className="rounded-full bg-white px-3 py-2 text-xs font-black text-brand-700">自动整理</button>
            </div>
          </div>
          <div className={`rounded-[22px] bg-white/78 p-4 ${device === 'mobile' ? 'mx-auto max-w-sm' : device === 'tablet' ? 'mx-auto max-w-3xl' : ''}`}>
            <PageLayoutCanvasEditor
              pageKey={pageKey}
              config={previewConfig}
              modules={rendererModules}
              moduleDefinitions={layout.registry}
              device={device}
              selectedKey={selected?.key || ''}
              readOnly={Boolean(selectedRevision)}
              onSelect={(key) => { setSelectedKey(key); setSelectedRevision(null) }}
              onChange={(items) => updateDeviceItems(() => items)}
              onAutoHeightChange={updateAutoHeight}
            />
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
            <h2 className="text-lg font-black text-brand-950">属性面板</h2>
            {selected && selectedModule && grid ? (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-sm font-black text-brand-950">{selectedModule.name}</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{selectedModule.description}</p>
                </div>

                <div className="rounded-2xl bg-sky-50 px-3 py-3 text-xs font-black leading-6 text-slate-600">
                  位置与尺寸：x{grid.x} y{grid.y} · {grid.w}x{grid.h}
                  <br />
                  请在画布中直接拖动模块，或拖拉模块边缘调整大小。
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-black text-slate-600">显示状态</span>
                  {selected.isHidden ? (
                    <button type="button" onClick={() => updateSelected({ visible: true, isHidden: false })} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">显示模块</button>
                  ) : selectedModule.canHide && !selectedModule.required ? (
                    <button type="button" onClick={() => updateSelected({ visible: false, isHidden: true })} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">隐藏模块</button>
                  ) : (
                    <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700">核心模块不可隐藏</span>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm font-black text-slate-600">
                  <input type="checkbox" checked={!selected.isHidden} disabled={selectedModule.required || !selectedModule.canHide} onChange={(event) => updateSelected({ visible: event.target.checked, isHidden: !event.target.checked })} />
                  显示模块{selectedModule.required ? '（核心模块）' : ''}
                </label>

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
          </section>

          <section className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
            <h2 className="text-lg font-black text-brand-950">版本历史</h2>
            <div className="mt-4 grid gap-2">
              {revisions.map((revision) => (
                <div key={revision.id} className={`rounded-2xl border p-3 ${selectedRevision?.id === revision.id ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-brand-950">v{revision.version} · {revision.source}</p>
                    <button onClick={() => setSelectedRevision(revision)} className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">预览</button>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">{formatDate(revision.createdAt)} · {revision.publishedByName || '未知管理员'}</p>
                  {revision.note ? <p className="mt-1 text-xs font-bold text-slate-500">{revision.note}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button disabled={isSaving} onClick={() => restoreRevision(revision, false)} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700">恢复到草稿</button>
                    <button disabled={isSaving} onClick={() => restoreRevision(revision, true)} className="rounded-full bg-brand-950 px-3 py-1.5 text-xs font-black text-white">恢复并发布</button>
                  </div>
                </div>
              ))}
              {!revisions.length ? <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-slate-500">暂无发布历史，首次发布后会生成版本记录。</p> : null}
            </div>
          </section>
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
