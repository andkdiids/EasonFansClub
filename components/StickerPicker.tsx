'use client'

import { useCallback, CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

/**
 * 微信式表情面板（内联展开，非弹窗）：
 *
 * 由调用方放在输入区域附近的 relative 容器内，面板通过 absolute 定位
 * 在输入区域上方展开，不使用全屏遮罩 / Modal / Dialog。
 *
 * 顶部：当前表情包区域 + 单张表情网格（不再是 4 个固定 tab）
 * 底部：搜索按钮 / 系统 emoji / 用户已添加表情包 icon + 「+」添加入口
 *
 * 空态：无任何已添加表情时显示「暂无表情包」+「去添加表情包」按钮（跳 /stickers）
 *
 * 后端数据模型：
 *  - showData.packs = 用户已添加的表情包（UserStickerPack）
 *  - showData.stickersByPack[packId] = 该表情包下所有可见 Sticker
 *  - showData.systemEmojis = 最近使用 + 系统 emoji（保底）
 *  - showData.searchIndex = 全站可见表情（用于搜索）
 */

export type PickerSticker = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  packId?: string
}

type StickerPackLite = {
  id: string
  name: string
  iconUrl: string | null
  coverUrl: string | null
}

type PickerView = 'emojis' | 'pack' | 'search'

export type PickerDataResponse = {
  success?: boolean
  error?: string
  packs: StickerPackLite[]
  stickersByPack: Record<string, PickerSticker[]>
  recent: PickerSticker[]
  systemEmojis: string[]
  searchIndex: PickerSticker[]
  fetchedAt?: string
}

export function StickerPicker({
  open,
  onClose,
  onSelectSticker,
  onSelectEmoji,
  composerRef,
  desktopColumns,
  mobileColumns,
  mobileCellPx,
  desktopCellPx,
  variant = 'dm',
}: {
  open: boolean
  onClose: () => void
  onSelectSticker: (sticker: PickerSticker) => void
  onSelectEmoji?: (emoji: string) => void
  composerRef?: React.RefObject<HTMLTextAreaElement | null>
  // 桌面端自定义表情固定列数（如私信 5 列、帖子回复 8 列）。不传则沿用自适应 72px 网格。
  desktopColumns?: number
  // 移动端固定列数（如私信 5 列）。不传则按容器宽度自适应（minmax(56px,1fr)，约 4~5 列）。
  mobileColumns?: number
  // 移动端单格最大宽度(px)。指定后网格居中、单格不超过该值，避免表情在宽面板中被放大撑满。
  mobileCellPx?: number
  // 桌面端单格最大宽度(px)。同上。
  desktopCellPx?: number
  // 'dm'（默认，私信全宽面板）或 'reply'（帖子回复小型浮层 420px / 8 列固定 / emoji 紧凑）。
  variant?: 'dm' | 'reply'
}) {
  const [data, setData] = useState<PickerDataResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<PickerView>('emojis')
  const [activePackId, setActivePackId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // 自定义表情长按预览（仅移动端 touch 触发；桌面尺寸足够大，无需预览）
  const [preview, setPreview] = useState<PickerSticker | null>(null)
  const previewRef = useRef<PickerSticker | null>(null)
  const previewSourceRef = useRef<'touch' | 'mouse' | null>(null)

  const openPreview = useCallback((s: PickerSticker, source: 'touch' | 'mouse') => {
    setPreview(s)
    previewRef.current = s
    previewSourceRef.current = source
  }, [])
  const closePreview = useCallback(() => {
    setPreview(null)
    previewRef.current = null
    previewSourceRef.current = null
  }, [])

  // 点击面板外部或按 Esc 关闭（内联面板，没有遮罩层可以点）
  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      // 大图预览展示时，点击遮罩不应关闭整个面板（预览优先关闭）
      if (previewRef.current) return
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewRef.current) {
          closePreview()
          return
        }
        onClose()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, onClose, closePreview])

  // 移动端长按（touch）打开大图后，手指松开 / 取消即关闭
  useEffect(() => {
    if (preview && previewSourceRef.current === 'touch') {
      const handler = () => closePreview()
      document.addEventListener('pointerup', handler, { once: true })
      document.addEventListener('pointercancel', handler, { once: true })
      return () => {
        document.removeEventListener('pointerup', handler)
        document.removeEventListener('pointercancel', handler)
      }
    }
  }, [preview, closePreview])

  const handleEmojiClick = useCallback(
    (emoji: string) => {
      if (onSelectEmoji) {
        onSelectEmoji(emoji)
        return
      }
      // fallback: insert directly into textarea if no callback provided
      const textarea = composerRef?.current
      if (textarea) {
        const start = textarea.selectionStart ?? textarea.value.length
        const end = textarea.selectionEnd ?? textarea.value.length
        const before = textarea.value.slice(0, start)
        const after = textarea.value.slice(end)
        textarea.value = `${before}${emoji}${after}`
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.focus()
        const caret = start + emoji.length
        textarea.setSelectionRange(caret, caret)
      }
    },
    [composerRef, onSelectEmoji],
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stickers/center?mode=picker', { cache: 'no-store' })
      const json = (await res.json()) as PickerDataResponse
      if (!res.ok || !json.success) {
        setError(json.error || '加载失败，请稍后重试')
        return
      }
      setData(json)
      // 默认始终进入系统 Emoji 面板（微信式体验）。
      // 记录第一个表情包 id 供用户主动点击 pack icon 时使用，但不自动切换到 pack 视图。
      const firstPack = json.packs[0]
      setActivePackId(firstPack ? firstPack.id : null)
      setView('emojis')
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && !data && !loading) {
      void fetchData()
    }
    if (!open) {
      // 关闭时重置搜索态，避免下次打开带着旧 query
      setSearchQuery('')
    }
  }, [open, data, loading, fetchData])

  const currentPack = useMemo(
    () => data?.packs.find((p) => p.id === activePackId) || null,
    [data, activePackId],
  )

  const currentStickers = useMemo(() => {
    if (!data || !activePackId) return []
    return data.stickersByPack[activePackId] || []
  }, [data, activePackId])

  const searchResults = useMemo(() => {
    if (!data) return []
    const q = searchQuery.trim()
    if (!q) return data.searchIndex.slice(0, 60)
    const lower = q.toLowerCase()
    return data.searchIndex.filter((s) => (s.name || '').toLowerCase().includes(lower)).slice(0, 60)
  }, [data, searchQuery])

  const noPacks = data && data.packs.length === 0

  // 网格列数与最大宽度通过 CSS 变量传入静态类 .sticker-pack-grid。
  // 不再用动态拼接的 Tailwind 任意值类名（JIT 无法识别运行时模板字符串 → 样式不生成 → 表情撑满面板）。
  // mobileCellPx/desktopCellPx > 0 时按 N×px 限量网格宽度并居中，避免宽面板下表情被放大；
  // 未指定(0/undefined)时网格铺满容器，单元格随列宽自适应。
  const gridStyle = {
    '--sg-cols': String(mobileColumns ?? 5),
    '--sg-cols-md': String(desktopColumns ?? mobileColumns ?? 5),
    '--sg-maxw':
      mobileCellPx && mobileCellPx > 0
        ? `calc(${mobileColumns ?? 5} * ${mobileCellPx}px + ${Math.max((mobileColumns ?? 5) - 1, 0)} * 0.5rem)`
        : 'none',
    '--sg-maxw-md':
      desktopCellPx && desktopCellPx > 0
        ? `calc(${desktopColumns ?? mobileColumns ?? 5} * ${desktopCellPx}px + ${Math.max((desktopColumns ?? mobileColumns ?? 5) - 1, 0)} * 0.5rem)`
        : 'none',
  } as CSSProperties

  // reply 变体：小型浮层（桌面 584px 容纳 8×64px / 移动 calc(100vw-32px)），固定网格，emoji 紧凑排列。
  // dm 变体（默认）：全宽面板，CSS 变量网格，emoji 10 列。
  const isReply = variant === 'reply'
  const panelClassName = isReply
    ? 'sticker-wechat-panel absolute bottom-full left-0 z-40 mb-2 flex h-[min(60vh,360px)] w-[584px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[16px] bg-white shadow-2xl ring-1 ring-black/10'
    : 'sticker-wechat-panel absolute inset-x-0 bottom-full z-40 mb-2 flex h-[min(60vh,360px)] flex-col overflow-hidden rounded-[16px] bg-white shadow-2xl ring-1 ring-black/10'
  const gridClassName = isReply
    ? 'sticker-reply-grid px-2 py-2'
    : 'sticker-pack-grid px-2 py-2'

  if (!open) return null

  return (
    <div
      ref={rootRef}
      className={panelClassName}
      role="dialog"
      aria-label="表情面板"
    >
      {/* 顶部标题栏：当前表情包 + 关闭（压缩上下空白） */}
      <header className="flex items-center justify-between border-b border-black/5 bg-white px-3 py-1.5">
          <div className="min-w-0 flex-1">
            {view === 'pack' && currentPack ? (
              <button
                type="button"
                onClick={() => setView('emojis')}
                className="flex items-center gap-2 text-[15px] font-bold text-slate-700"
              >
                <span aria-hidden>‹</span>
                <span className="truncate">{currentPack.name}</span>
              </button>
            ) : view === 'search' ? (
              <span className="text-[15px] font-bold text-slate-700">搜索表情</span>
            ) : (
              <span className="text-[15px] font-bold text-slate-700">表情</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100"
            aria-label="关闭表情面板"
          >
            ×
          </button>
        </header>

        {/* 主内容区（pb-4 底部安全间距，防止最后一排表情被工具栏裁切） */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-white pb-4">
          {loading ? (
            <div className="flex h-full items-center justify-center py-12 text-sm text-slate-400">加载中…</div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-sm">
              <p className="text-red-500">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setData(null)
                  void fetchData()
                }}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200"
              >
                重试
              </button>
            </div>
          ) : view === 'search' ? (
            // 搜索视图
            <div className="flex flex-col">
              <div className="sticky top-0 z-10 border-b border-black/5 bg-white px-3 py-2">
                <input
                  type="search"
                  autoFocus
                  placeholder="搜索表情名称"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-full bg-slate-100 px-4 py-2 text-sm outline-none placeholder:text-slate-400"
                />
              </div>
              <div className={gridClassName} style={isReply ? undefined : gridStyle}>
                {searchResults.length === 0 ? (
                  <p className="col-span-full w-full py-10 text-center text-sm text-slate-400">无匹配表情</p>
                ) : (
                  searchResults.map((s) => (
                    <StickerCell key={s.id} sticker={s} onSelect={() => onSelectSticker(s)} onPreview={openPreview} previewing={preview?.id === s.id} />
                  ))
                )}
              </div>
            </div>
          ) : view === 'pack' ? (
            // 我的表情包视图：有选中表情包则展示其表情；没有添加任何表情包时才显示空状态
            currentPack ? (
              <div className={gridClassName} style={isReply ? undefined : gridStyle}>
                {currentStickers.length === 0 ? (
                  <p className="col-span-full w-full py-10 text-center text-sm text-slate-400">这个表情包还没有表情</p>
                ) : (
                  currentStickers.map((s) => (
                    <StickerCell key={s.id} sticker={s} onSelect={() => onSelectSticker(s)} onPreview={openPreview} previewing={preview?.id === s.id} />
                  ))
                )}
              </div>
            ) : noPacks ? (
              // 仅当用户主动进入「我的表情包」且确实没有添加任何表情包时显示空状态
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-3xl">😊</span>
                <p className="text-sm font-bold text-slate-600">还没有添加表情包</p>
                <p className="text-xs text-slate-400">去表情商店添加你喜欢的表情包即可使用</p>
                <Link
                  href="/stickers"
                  onClick={onClose}
                  className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700"
                >
                  去添加表情包
                </Link>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-400">请选择一个表情包</p>
            )
          ) : (
            // 默认 emoji 视图（第一屏）：始终展示系统 Emoji + 最近使用，无论是否添加了表情包
              <EmojiGrid
                emojis={data?.systemEmojis || []}
                recent={data?.recent || []}
                onSelectSticker={onSelectSticker}
                onSelectEmoji={handleEmojiClick}
                compact={isReply}
              />
          )}
        </div>

        {/* 底部导航：搜索 / emoji / 已添加表情包 icons / + 添加 */}
        <nav className="flex items-center gap-1 border-t border-black/5 bg-white px-2 py-2" aria-label="表情包导航">
          <button
            type="button"
            onClick={() => setView('search')}
            className="grid h-9 w-9 flex-none place-items-center rounded-md text-slate-500 transition hover:bg-slate-100"
            aria-label="搜索表情"
            title="搜索"
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            onClick={() => setView('emojis')}
            className={`grid h-9 w-9 flex-none place-items-center rounded-md text-xl transition ${view === 'emojis' ? 'bg-amber-100' : 'hover:bg-slate-100'}`}
            aria-label="系统 emoji"
            title="表情"
          >
            😀
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1" role="tablist">
            {data?.packs.map((pack) => {
              // 入口图标统一优先使用封面 coverUrl；封面为空再回退到该表情包的第一张表情。
              // 不再使用 iconUrl（后端曾把它设为第一张表情 url，会覆盖封面）。
              const packIcon = pack.coverUrl || data?.stickersByPack[pack.id]?.[0]?.url || ''
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => {
                    setActivePackId(pack.id)
                    setView('pack')
                  }}
                  className={`relative grid h-7 w-7 flex-none cursor-pointer place-items-center overflow-hidden rounded-md ring-1 transition sm:h-8 sm:w-8 ${activePackId === pack.id && view === 'pack' ? 'ring-2 ring-amber-400' : 'ring-slate-200 hover:ring-slate-300'}`}
                  aria-label={`表情包：${pack.name}`}
                  title={pack.name}
                >
                  {packIcon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={packIcon} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-base sm:text-lg">😊</span>
                  )}
                </button>
              )
            })}
          </div>

          <Link
            href="/stickers"
            onClick={onClose}
            className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-md bg-amber-50 text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100"
            aria-label="去表情商店添加更多"
            title="添加表情包"
          >
            +
          </Link>
        </nav>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="m20 20-3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// 等比例方块格：aspect-square 让格子随列宽缩放为正方形（列宽由 .sticker-pack-grid 的 max-width 限量）。
// 不使用 w-full —— 网格项默认 stretch 填充列轨道，aspect-square 保证高度=宽度，无需显式宽度。
export function desktopCellClass(): string {
  return 'relative flex aspect-square items-center justify-center rounded-md transition hover:bg-slate-100 active:scale-95'
}

export function desktopImgClass(): string {
  return 'h-full w-full rounded-md object-contain p-1'
}

function EmojiGrid({
  emojis,
  recent,
  onSelectSticker,
  onSelectEmoji,
  compact,
}: {
  emojis: string[]
  recent: PickerSticker[]
  onSelectSticker: (sticker: PickerSticker) => void
  onSelectEmoji: (emoji: string) => void
  // 帖子回复场景：emoji 用 flex-wrap 紧凑排列（32px / text-[28px]）；私信场景用 10 列 grid。
  compact?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {recent.length > 0 ? (
        <section>
          <h3 className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">最近使用</h3>
          <div className="flex flex-wrap gap-1.5">
            {recent.slice(0, 8).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSticker(s)}
                className="grid h-10 w-10 place-items-center rounded-md transition hover:bg-slate-100 active:scale-95 md:h-12 md:w-12"
                aria-label={s.name || '表情'}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.name || ''} className="h-full w-full object-contain p-0.5" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3 className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">默认表情</h3>
        <div className={compact ? 'flex flex-wrap gap-3' : 'grid grid-cols-10 gap-2'}>
          {emojis.map((em, idx) => (
            <button
              key={`${em}-${idx}`}
              type="button"
              onClick={() => onSelectEmoji(em)}
              className={compact
                ? 'flex h-8 w-8 items-center justify-center rounded-md text-[28px] leading-none transition hover:bg-slate-100 active:scale-95'
                : 'flex aspect-square items-center justify-center rounded-md text-[24px] leading-none transition hover:bg-slate-100 active:scale-95'
              }
              aria-label={`emoji ${em}`}
            >
              {em}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * 自定义表情格子（紧凑、无白色卡片背景，响应式尺寸）。
 * 仅移动端长按（touch）触发微信式气泡预览；短按发送；touch 预览触发后抑制本次 click 发送。
 * 桌面尺寸已足够大，无需预览。
 */
function StickerCell({
  sticker,
  onSelect,
  onPreview,
  previewing,
}: {
  sticker: PickerSticker
  onSelect: () => void
  onPreview: (sticker: PickerSticker, source: 'touch' | 'mouse') => void
  previewing: boolean
}) {
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const didPreviewRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // 仅移动端（touch）需要长按预览；桌面尺寸已足够大，直接点击发送。
    if (e.pointerType === 'touch') {
      startRef.current = { x: e.clientX, y: e.clientY }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        didPreviewRef.current = true
        onPreview(sticker, 'touch')
      }, 500)
    }
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'touch') clearTimer()
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    // 滑动（>10px）取消长按，避免滚动时误触发预览
    if (e.pointerType === 'touch' && startRef.current) {
      const dx = Math.abs(e.clientX - startRef.current.x)
      const dy = Math.abs(e.clientY - startRef.current.y)
      if (dx > 10 || dy > 10) clearTimer()
    }
  }
  const handleClick = () => {
    // 长按已触发预览时，松开后的 click 不再发送该表情
    if (didPreviewRef.current) {
      didPreviewRef.current = false
      return
    }
    onSelect()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      className={desktopCellClass()}
      aria-label={sticker.name || '表情'}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sticker.url} alt={sticker.name || ''} className={desktopImgClass()} loading="lazy" />
      {/* 微信式长按预览气泡：跟随当前表情按钮，移动端长按时出现，松手/移开即关闭 */}
      {previewing ? (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl bg-white p-3 shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sticker.url} alt={sticker.name || '表情'} className="block h-[180px] w-[180px] rounded-md object-contain" />
        </span>
      ) : null}
    </button>
  )
}
