'use client'

import { useMemo, useState } from 'react'

export type MyStickerItem = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  usageCount: number
  createdAt: string
}

function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function MyStickerManager({ initialStickers }: { initialStickers: MyStickerItem[] }) {
  const [stickers, setStickers] = useState<MyStickerItem[]>(initialStickers)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const removing = useMemo(() => stickers.find((s) => s.id === confirmId) || null, [stickers, confirmId])

  async function handleDelete() {
    if (!confirmId) return
    setBusyId(confirmId)
    setMessage(null)
    try {
      const res = await fetch(`/api/stickers/${confirmId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage(data?.message || '删除失败')
        return
      }
      setStickers((current) => current.filter((s) => s.id !== confirmId))
      setMessage('已删除该表情')
      setConfirmId(null)
    } catch {
      setMessage('网络错误，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-5">
      {message ? (
        <p className="rounded-2xl bg-sky-50 px-4 py-2 text-sm font-bold text-brand-700 ring-1 ring-sky-100">{message}</p>
      ) : null}

      {stickers.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/60 px-4 py-12 text-center">
          <p className="text-sm font-bold text-slate-400">你还没有上传表情包</p>
          <p className="mt-1 text-xs font-bold text-slate-300">前往「表情包上传」提交你的第一个表情吧</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5">
          {stickers.map((sticker) => (
            <article key={sticker.id} className="rounded-2xl border border-sky-100 bg-white/90 p-3 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sticker.url}
                alt={sticker.name || '表情'}
                className="mx-auto h-20 w-20 rounded-xl bg-white object-contain"
              />
              <p className="mt-2 truncate text-center text-xs font-bold text-slate-500">{sticker.name || '未命名'}</p>
              <dl className="mt-1 space-y-0.5 text-center text-[11px] font-bold text-slate-400">
                <div>添加：{formatDate(sticker.createdAt)}</div>
                <div>使用：{sticker.usageCount} 次</div>
              </dl>
              <button
                type="button"
                disabled={busyId === sticker.id || confirmId === sticker.id}
                onClick={() => setConfirmId(sticker.id)}
                className="mt-2 w-full rounded-full bg-white px-3 py-1.5 text-xs font-black text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
              >
                删除
              </button>
            </article>
          ))}
        </div>
      )}

      {removing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-[28px] border border-sky-100 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-black text-brand-950">删除表情</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              确定删除「{removing.name || '该表情'}」吗？删除后将无法恢复，且会从评论与私信选择器中移除。
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={busyId === removing.id}
                onClick={handleDelete}
                className="flex-1 rounded-full bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                确认删除
              </button>
              <button
                type="button"
                disabled={busyId === removing.id}
                onClick={() => setConfirmId(null)}
                className="flex-1 rounded-full bg-white px-4 py-2.5 text-sm font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
