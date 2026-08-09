'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { StorePackItem } from '@/lib/sticker-center'

export function StickerStoreGrid(props: {
  packs: StorePackItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  sort: 'hot' | 'new' | 'official'
  category: string | null
}) {
  const { packs, total, page, totalPages, sort, category } = props
  const [busy, setBusy] = useState<string | null>(null)
  const [localPacks, setLocalPacks] = useState<StorePackItem[]>(packs)

  async function toggleAdd(pack: StorePackItem) {
    if (busy) return
    const optimistic = !pack.added
    setLocalPacks((current) => current.map((p) => (p.id === pack.id ? { ...p, added: optimistic } : p)))
    setBusy(pack.id)
    try {
      const res = await fetch(`/api/stickers/store/${pack.id}/add`, { method: optimistic ? 'POST' : 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || '操作失败')
      setLocalPacks((current) => current.map((p) => (p.id === pack.id ? { ...p, added: data.added === true ? true : data.removed === false ? true : optimistic } : p)))
    } catch (err) {
      // 回滚
      setLocalPacks((current) => current.map((p) => (p.id === pack.id ? { ...p, added: pack.added } : p)))
      alert(err instanceof Error ? err.message : '网络错误')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between text-sm font-bold text-slate-500">
        <span>{total > 0 ? `共 ${total} 个表情包` : '商店暂无表情包'}</span>
        {totalPages > 1 ? (
          <span>第 {page} / {totalPages} 页</span>
        ) : null}
      </div>

      {localPacks.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/60 px-4 py-16 text-center text-sm font-bold text-slate-400">
          商店中暂无表情包，快去上传一个吧
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {localPacks.map((pack) => (
            <article key={pack.id} className="flex flex-col overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <Link href={`/stickers/${pack.id}`} className="block aspect-square overflow-hidden bg-slate-50">
                {pack.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pack.coverUrl} alt={pack.name} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-5xl">😊</div>
                )}
              </Link>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <Link href={`/stickers/${pack.id}`} className="line-clamp-1 text-sm font-black text-brand-950 hover:underline">
                  {pack.name}
                </Link>
                <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
                  <span className="truncate">
                    {pack.isOfficial ? '官方' : pack.creator?.nickname || '匿名用户'}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>{pack.stickerCount} 张</span>
                </div>
                <div className="text-[11px] font-bold text-slate-500">
                  下载：<span className="text-brand-700">{pack.downloadCount.toLocaleString('zh-CN')}</span>
                </div>
                <button
                  type="button"
                  disabled={busy === pack.id}
                  onClick={() => void toggleAdd(pack)}
                  className={`mt-auto w-full rounded-full px-3 py-1.5 text-xs font-black transition disabled:opacity-50 ${pack.added ? 'border border-slate-300 bg-white text-slate-500 hover:bg-slate-50' : 'bg-brand-700 text-white hover:bg-brand-800'}`}
                  aria-label={pack.added ? '取消添加' : '添加到表情库'}
                >
                  {busy === pack.id ? '处理中…' : pack.added ? '已添加' : '添加'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex flex-wrap items-center justify-center gap-2 text-sm font-bold">
          {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 12).map((p) => (
            <Link
              key={p}
              href={`/stickers?sort=${sort}${category ? `&category=${encodeURIComponent(category)}` : ''}&page=${p}`}
              className={p === page ? 'pill-active' : 'pill'}
            >
              {p}
            </Link>
          ))}
        </nav>
      ) : null}
    </section>
  )
}
