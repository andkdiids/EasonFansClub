'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { StorePackItem } from '@/lib/sticker-center'
import { publicImageVariantUrl } from '@/lib/image-variants'

type UploadPack = {
  id: string
  name: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  reviewedAt: string | null
  createdAt: string
  coverUrl: string | null
  type: 'STATIC' | 'GIF'
  isOfficial: boolean
}

export function MyStickerLibrary({
  initialLibrary,
  initialUploads,
}: {
  initialLibrary: StorePackItem[]
  initialUploads: UploadPack[]
}) {
  const [tab, setTab] = useState<'library' | 'uploads'>('library')
  const [library, setLibrary] = useState(initialLibrary)
  const [busy, setBusy] = useState<string | null>(null)

  async function remove(packId: string) {
    if (!confirm('确定从你的表情库移除这个表情包吗？仅取消添加，不会删除官方资源。')) return
    setBusy(packId)
    try {
      const res = await fetch(`/api/stickers/store/${packId}/add`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || '操作失败')
      setLibrary((current) => current.filter((p) => p.id !== packId))
    } catch (err) {
      alert(err instanceof Error ? err.message : '网络错误')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`pill ${tab === 'library' ? 'pill-active' : ''}`}
        >
          已添加表情包 {library.length > 0 ? `(${library.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setTab('uploads')}
          className={`pill ${tab === 'uploads' ? 'pill-active' : ''}`}
        >
          我创建的表情包 {initialUploads.length > 0 ? `(${initialUploads.length})` : ''}
        </button>
        <style>{`
          .pill { padding: 7px 14px; border-radius: 9999px; background: #fff; color: #475569; border: 1px solid #cbd5e1; font-weight: 700; }
          .pill:hover { background: #f1f5f9; }
          .pill-active { padding: 7px 14px; border-radius: 9999px; background: #0e58bd; color: #fff; border: 1px solid #0e58bd; font-weight: 800; }
        `}</style>
      </div>

      {tab === 'library' ? (
        library.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/60 px-4 py-16 text-center">
            <p className="text-base font-black text-slate-700">暂无表情包</p>
            <p className="mt-2 text-sm font-bold text-slate-400">去表情商店添加喜欢的表情包即可使用</p>
            <Link href="/stickers" className="mt-4 inline-flex flat-button-primary">去添加表情包</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {library.map((pack) => (
              <article key={pack.id} className="flex flex-col overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm">
                <Link href={`/stickers/${pack.id}`} className="block aspect-square overflow-hidden bg-slate-50">
                  {pack.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={publicImageVariantUrl(pack.coverUrl, 'thumb-md') || pack.coverUrl} alt={pack.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-5xl">😊</div>
                  )}
                </Link>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <Link href={`/stickers/${pack.id}`} className="line-clamp-1 text-sm font-black text-brand-950 hover:underline">
                    {pack.name}
                  </Link>
                  <p className="text-[11px] font-bold text-slate-500">{pack.stickerCount} 张 · 下载 {pack.downloadCount.toLocaleString('zh-CN')}</p>
                  <button
                    type="button"
                    onClick={() => void remove(pack.id)}
                    disabled={busy === pack.id}
                    className="mt-auto rounded-full bg-white px-3 py-1.5 text-xs font-black text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === pack.id ? '处理中…' : '取消添加'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )
      ) : initialUploads.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/60 px-4 py-16 text-center">
          <p className="text-base font-black text-slate-700">你还没创建过表情包</p>
          <p className="mt-2 text-sm font-bold text-slate-400">提交审核后即可在商店中上架</p>
          <Link href="/stickers/upload" className="mt-4 inline-flex flat-button-primary">上传表情包</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {initialUploads.map((pack) => (
            <article key={pack.id} className="flex items-center gap-4 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
              <div className="h-20 w-20 flex-none overflow-hidden rounded-xl bg-slate-50">
                {pack.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={publicImageVariantUrl(pack.coverUrl, 'thumb-sm') || pack.coverUrl} alt={pack.name} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-3xl">😊</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-black text-brand-950">{pack.name}</h3>
                  {pack.isOfficial ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-700">官方</span>
                  ) : null}
                  <StatusBadge status={pack.status} />
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500">提交时间：{formatDate(pack.createdAt)}</p>
                {pack.status === 'REJECTED' && pack.rejectionReason ? (
                  <p className="mt-1 line-clamp-2 text-xs font-bold text-red-600">管理员反馈：{pack.rejectionReason}</p>
                ) : null}
              </div>
              {pack.status === 'APPROVED' ? (
                <Link href={`/stickers/${pack.id}`} className="flat-button-secondary">查看</Link>
              ) : (
                <Link href={`/profile/stickers/${pack.id}/edit`} className="flat-button-secondary">
                  {pack.status === 'REJECTED' ? '继续修改' : '查看状态'}
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function StatusBadge({ status }: { status: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  if (status === 'PENDING') {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-700">待审核</span>
  }
  if (status === 'APPROVED') {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700">已上架</span>
  }
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black text-red-700">审核未通过</span>
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}
