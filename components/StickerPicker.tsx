'use client'

import { useEffect, useMemo, useState } from 'react'

export type PickerSticker = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
}

type TabKey = 'recent' | 'favorites' | 'official' | 'myUploads'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'recent', label: '最近使用' },
  { key: 'favorites', label: '收藏' },
  { key: 'official', label: '官方' },
  { key: 'myUploads', label: '我的上传' },
]

function sortByUsageThenCreated(list: PickerSticker[]): PickerSticker[] {
  // 使用次数无法直接在前端获取，这里 recent 已按使用时间排序；其余标签保持服务端返回顺序。
  return list
}

export function StickerPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (sticker: PickerSticker) => void
}) {
  const [tab, setTab] = useState<TabKey>('recent')
  const [data, setData] = useState<{
    recent: PickerSticker[]
    favorites: PickerSticker[]
    official: PickerSticker[]
    myUploads: PickerSticker[]
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || data) return
    let active = true
    setLoading(true)
    setError(null)
    fetch('/api/stickers/center?mode=picker')
      .then((res) => res.json())
      .then((json) => {
        if (!active) return
        if (json?.success) setData(json)
        else setError(json?.message || '加载失败')
      })
      .catch(() => active && setError('网络错误，请稍后重试'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [open, data])

  const list = useMemo(() => {
    if (!data) return []
    if (tab === 'recent') return data.recent
    if (tab === 'favorites') return sortByUsageThenCreated(data.favorites)
    if (tab === 'official') return sortByUsageThenCreated(data.official)
    return sortByUsageThenCreated(data.myUploads)
  }, [data, tab])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-sky-100 bg-white shadow-xl sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-black text-brand-950">选择表情</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm font-black text-slate-400 transition hover:bg-slate-100"
          >
            关闭
          </button>
        </div>

        <div className="flex flex-wrap gap-2 px-4 py-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-black transition ${
                tab === t.key ? 'bg-brand-600 text-white' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200 hover:bg-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {loading ? (
            <p className="py-10 text-center text-sm font-bold text-slate-400">加载中…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm font-bold text-red-500">{error}</p>
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-slate-400">
              {tab === 'favorites' ? '还没有收藏的表情' : tab === 'myUploads' ? '你还没有上传表情' : '暂无表情'}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {list.map((sticker) => (
                <button
                  key={sticker.id}
                  type="button"
                  onClick={() => onSelect(sticker)}
                  className="flex items-center justify-center rounded-xl border border-slate-100 bg-white p-1.5 transition hover:border-brand-300 hover:bg-sky-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sticker.url} alt={sticker.name || '表情'} className="h-14 w-14 object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
