'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
}: {
  open: boolean
  onClose: () => void
  onSelectSticker: (sticker: PickerSticker) => void
  onSelectEmoji?: (emoji: string) => void
  composerRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [data, setData] = useState<PickerDataResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<PickerView>('emojis')
  const [activePackId, setActivePackId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // 自定义表情大图预览（长按 / 悬停触发）
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

  if (!open) return null

  return (
    <div
      ref={rootRef}
      className="sticker-wechat-panel absolute inset-x-0 bottom-full z-40 mb-2 flex h-[min(60vh,360px)] flex-col overflow-hidden rounded-[16px] bg-[#EDEDED] shadow-2xl ring-1 ring-black/10"
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

        {/* 主内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#EDEDED]">
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
              <div className="flex flex-wrap gap-1 px-2 py-2">
                {searchResults.length === 0 ? (
                  <p className="w-full py-10 text-center text-sm text-slate-400">无匹配表情</p>
                ) : (
                  searchResults.map((s) => (
                    <StickerCell key={s.id} sticker={s} onSelect={() => onSelectSticker(s)} onPreview={openPreview} />
                  ))
                )}
              </div>
            </div>
          ) : view === 'pack' ? (
            // 我的表情包视图：有选中表情包则展示其表情；没有添加任何表情包时才显示空状态
            currentPack ? (
              <div className="flex flex-wrap gap-1 px-2 py-2">
                {currentStickers.length === 0 ? (
                  <p className="w-full py-10 text-center text-sm text-slate-400">这个表情包还没有表情</p>
                ) : (
                  currentStickers.map((s) => (
                    <StickerCell key={s.id} sticker={s} onSelect={() => onSelectSticker(s)} onPreview={openPreview} />
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
        {preview ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={closePreview}
            role="dialog"
            aria-label="表情大图预览"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={preview.name || '表情'}
              className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain sm:max-w-[400px]"
            />
          </div>
        ) : null}
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

function EmojiGrid({
  emojis,
  recent,
  onSelectSticker,
  onSelectEmoji,
}: {
  emojis: string[]
  recent: PickerSticker[]
  onSelectSticker: (sticker: PickerSticker) => void
  onSelectEmoji: (emoji: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {recent.length > 0 ? (
        <section>
          <h3 className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">最近使用</h3>
          <div className="grid grid-cols-8 gap-1">
            {recent.slice(0, 8).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSticker(s)}
                className="grid aspect-square place-items-center rounded-md bg-white transition hover:bg-slate-50 active:scale-95"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.name || ''} className="h-8 w-8 object-contain" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3 className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">默认表情</h3>
        <div className="grid grid-cols-8 gap-1">
          {emojis.map((em, idx) => (
            <button
              key={`${em}-${idx}`}
              type="button"
              onClick={() => onSelectEmoji(em)}
              className="grid aspect-square place-items-center rounded-md bg-white text-2xl transition hover:bg-slate-50 active:scale-95"
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
 * 自定义表情格子（紧凑、无白色卡片背景）。
 * 长按 / 悬停触发大图预览；短按发送；touch 预览触发后抑制本次 click 发送。
 */
function StickerCell({
  sticker,
  onSelect,
  onPreview,
}: {
  sticker: PickerSticker
  onSelect: () => void
  onPreview: (sticker: PickerSticker, source: 'touch' | 'mouse') => void
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
  const handlePointerEnter = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse') {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        onPreview(sticker, 'mouse')
      }, 500)
    }
  }
  const handlePointerLeave = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse') clearTimer()
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
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className="flex h-[42px] w-[42px] items-center justify-center rounded-md p-1 transition hover:bg-slate-100 active:scale-95 sm:h-[52px] sm:w-[52px]"
      aria-label={sticker.name || '表情'}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sticker.url} alt={sticker.name || ''} className="h-full w-full rounded-md object-contain" loading="lazy" />
    </button>
  )
}
