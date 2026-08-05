'use client'

import { useMemo, useState } from 'react'
import type { StickerPackRow, StickerRow } from './page'

type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'

const STATUS_LABEL: Record<StickerPackRow['status'], string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
}

const TYPE_LABEL: Record<StickerPackRow['type'], string> = {
  STATIC: '静态',
  GIF: '动态',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

export function StickerReviewManager({ initialPacks }: { initialPacks: StickerPackRow[] }) {
  const [packs, setPacks] = useState<StickerPackRow[]>(initialPacks)
  const [filter, setFilter] = useState<StatusFilter>('PENDING')
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const filtered = useMemo(() => {
    if (filter === 'ALL') return packs
    return packs.filter((p) => p.status === filter)
  }, [packs, filter])

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'PENDING', label: `待审核 (${packs.filter((p) => p.status === 'PENDING').length})` },
    { key: 'APPROVED', label: `已通过 (${packs.filter((p) => p.status === 'APPROVED').length})` },
    { key: 'REJECTED', label: `已拒绝 (${packs.filter((p) => p.status === 'REJECTED').length})` },
    { key: 'ALL', label: `全部 (${packs.length})` },
  ]

  function applyUpdate(updated: StickerPackRow) {
    setPacks((current) => {
      const next = current.map((p) => (p.id === updated.id ? updated : p))
      return next
    })
  }

  async function review(id: string, action: 'approve' | 'reject', reason?: string) {
    setMessage(null)
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/stickers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectionReason: reason ?? '' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.pack) {
        setMessage(data?.message || '操作失败')
        return
      }
      const updated = data.pack as StickerPackRow
      applyUpdate(updated)
      setMessage(action === 'approve' ? `已通过「${updated.name}」` : `已拒绝「${updated.name}」`)
      setRejectingId(null)
      setRejectReason('')
    } catch {
      setMessage('网络错误，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-black transition ${
              filter === tab.key
                ? 'bg-brand-600 text-white'
                : 'bg-white/80 text-slate-600 ring-1 ring-slate-200 hover:bg-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {message ? (
        <p className="rounded-2xl bg-sky-50 px-4 py-2 text-sm font-bold text-brand-700 ring-1 ring-sky-100">{message}</p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm font-bold text-slate-400">
          当前筛选下没有表情包合集
        </p>
      ) : (
        <div className="grid gap-5">
          {filtered.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              busy={busyId === pack.id}
              rejecting={rejectingId === pack.id}
              rejectReason={rejectReason}
              onRejectReasonChange={setRejectReason}
              onStartReject={() => {
                setRejectingId(pack.id)
                setRejectReason(pack.rejectionReason ?? '')
              }}
              onCancelReject={() => {
                setRejectingId(null)
                setRejectReason('')
              }}
              onApprove={() => review(pack.id, 'approve')}
              onReject={() => review(pack.id, 'reject', rejectReason)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PackCard({
  pack,
  busy,
  rejecting,
  rejectReason,
  onRejectReasonChange,
  onStartReject,
  onCancelReject,
  onApprove,
  onReject,
}: {
  pack: StickerPackRow
  busy: boolean
  rejecting: boolean
  rejectReason: string
  onRejectReasonChange: (value: string) => void
  onStartReject: () => void
  onCancelReject: () => void
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <article className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-brand-950">{pack.name}</h2>
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-black text-brand-700">
              {TYPE_LABEL[pack.type]}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-black ${
                pack.status === 'APPROVED'
                  ? 'bg-emerald-50 text-emerald-700'
                  : pack.status === 'REJECTED'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-amber-50 text-amber-700'
              }`}
            >
              {STATUS_LABEL[pack.status]}
            </span>
          </div>
          <p className="mt-1 text-sm font-bold text-slate-500">
            创作者：{pack.creator.nickname}（UID {pack.creator.uid}） · 提交于 {formatDate(pack.createdAt)}
          </p>
          {pack.description ? (
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-slate-600">{pack.description}</p>
          ) : null}
        </div>

        {pack.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pack.coverUrl}
            alt={`${pack.name} 封面`}
            className="h-20 w-20 rounded-2xl border border-slate-100 object-cover"
          />
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-xs font-black uppercase tracking-wider text-slate-400">
          表情预览（{pack.stickers.length}）
        </p>
        {pack.stickers.length === 0 ? (
          <p className="mt-2 text-sm font-bold text-slate-400">该合集还没有表情</p>
        ) : (
          <div className="mt-2 grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
            {pack.stickers.map((sticker: StickerRow) => (
              <figure key={sticker.id} className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sticker.url}
                  alt={sticker.name || pack.name}
                  className="h-16 w-16 rounded-xl border border-slate-100 bg-white object-contain"
                />
                {sticker.name ? (
                  <figcaption className="w-full truncate text-center text-xs font-bold text-slate-500">
                    {sticker.name}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        )}
      </div>

      {pack.status === 'REJECTED' && pack.rejectionReason ? (
        <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700">
          拒绝原因：{pack.rejectionReason}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {pack.status !== 'APPROVED' ? (
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            通过
          </button>
        ) : null}

        {rejecting ? (
          <div className="flex w-full flex-wrap items-center gap-3">
            <textarea
              value={rejectReason}
              onChange={(e) => onRejectReasonChange(e.target.value)}
              placeholder="填写拒绝原因（可选）"
              rows={2}
              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <button
              type="button"
              disabled={busy}
              onClick={onReject}
              className="rounded-full bg-red-600 px-5 py-2 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              确认拒绝
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancelReject}
              className="rounded-full bg-white px-5 py-2 text-sm font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              取消
            </button>
          </div>
        ) : (
          pack.status !== 'REJECTED' && (
            <button
              type="button"
              disabled={busy}
              onClick={onStartReject}
              className="rounded-full bg-white px-5 py-2 text-sm font-black text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
            >
              拒绝
            </button>
          )
        )}
      </div>
    </article>
  )
}
