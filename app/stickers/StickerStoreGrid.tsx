'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Pagination } from '@/components/ui/Pagination'
import type { StorePackItem } from '@/lib/sticker-center'
import { publicImageVariantUrl } from '@/lib/image-variants'

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
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [localPacks, setLocalPacks] = useState<StorePackItem[]>(packs)

  useEffect(() => {
    setLocalPacks(packs)
  }, [packs])

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

  function goToPage(nextPage: number) {
    const params = new URLSearchParams({ sort, page: String(nextPage) })
    if (category) params.set('category', category)
    router.push(`/stickers?${params.toString()}`)
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
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 md:gap-4 lg:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
          {localPacks.map((pack) => (
            <article key={pack.id} className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <Link
                href={`/stickers/${pack.id}`}
                aria-label={`查看表情包合集：${pack.name}`}
                className="absolute inset-0 z-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                <span className="sr-only">{pack.name}</span>
              </Link>
              <div className="relative z-10 aspect-square overflow-hidden bg-slate-50 pointer-events-none">
                {pack.coverUrl ? (
                  <Image
                    src={publicImageVariantUrl(pack.coverUrl, 'thumb-md') || pack.coverUrl}
                    alt={pack.name}
                    fill
                    sizes="(max-width: 639px) calc((100vw - 48px) / 3), (max-width: 767px) calc((100vw - 76px) / 4), (max-width: 1023px) calc((100vw - 104px) / 5), 160px"
                    className="object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-3xl">😊</div>
                )}
              </div>
              <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-1 p-2 pointer-events-none">
                <div className="min-h-[2.5rem] line-clamp-2 break-words text-[13px] font-semibold leading-5 text-brand-950">
                  {pack.name}
                </div>
                <div className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] font-bold leading-4 text-slate-500">
                  <span className="min-w-0 flex-1 truncate">
                    {pack.isOfficial ? '官方' : pack.creator?.nickname || '匿名用户'}
                  </span>
                  <span className="shrink-0 text-slate-300">·</span>
                  <span className="shrink-0">{pack.stickerCount} 张</span>
                </div>
                <div className="text-[11px] font-bold leading-4 text-slate-500">
                  下载：<span className="text-brand-700">{pack.downloadCount.toLocaleString('zh-CN')}</span>
                </div>
                <button
                  type="button"
                  disabled={busy === pack.id}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void toggleAdd(pack)
                  }}
                  className={`relative z-20 mt-auto min-h-8 w-full rounded-full px-2 py-1 text-[11px] font-black transition disabled:opacity-50 pointer-events-auto ${pack.added ? 'border border-slate-300 bg-white text-slate-500 hover:bg-slate-50' : 'bg-brand-700 text-white hover:bg-brand-800'}`}
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
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={goToPage}
          ariaLabel="表情包商店分页"
          className="sticker-store-pagination"
        />
      ) : null}
    </section>
  )
}
