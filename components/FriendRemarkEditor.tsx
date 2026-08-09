'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function FriendRemarkEditor({ targetUserId, initialRemark, baseDisplayName }: Readonly<{ targetUserId: string; initialRemark: string | null; baseDisplayName: string }>) {
  const router = useRouter()
  const [remark, setRemark] = useState(initialRemark || '')
  const [draft, setDraft] = useState(initialRemark || '')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function openEditor() {
    setDraft(remark)
    setError('')
    setOpen(true)
  }

  async function save() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/friends/${encodeURIComponent(targetUserId)}/remark`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: draft.trim() }),
      })
      const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; data?: { remark?: string | null } }
      if (!response.ok || !data.ok) throw new Error(data.message || '备注保存失败')
      const nextRemark = data.data?.remark || ''
      setRemark(nextRemark)
      setDraft(nextRemark)
      setOpen(false)
      window.dispatchEvent(new CustomEvent('friend-remark:updated', { detail: { targetUserId, remark: nextRemark || null, displayName: nextRemark || baseDisplayName } }))
      window.dispatchEvent(new Event('friend-dock:refresh'))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '备注保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-500">
      {remark ? <span>（备注：{remark}）</span> : <span>尚未设置备注</span>}
      <button type="button" onClick={openEditor} className="rounded-lg border border-sky-100 bg-white px-3 py-1.5 text-xs font-black text-brand-700 hover:bg-sky-50">
        {remark ? '修改备注' : '设置备注'}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false) }}>
          <div className="w-full max-w-sm rounded-2xl border border-sky-100 bg-white p-5 text-left shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="friend-remark-title">
            <h2 id="friend-remark-title" className="text-lg font-black text-brand-950">好友备注</h2>
            <input
              autoFocus
              value={draft}
              maxLength={20}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void save(); if (event.key === 'Escape' && !busy) setOpen(false) }}
              className="mt-4 w-full rounded-xl border border-sky-100 px-3 py-2.5 text-sm font-bold text-brand-950 outline-none focus:border-brand-400"
              placeholder="最多 20 个字符"
            />
            {error ? <p className="mt-2 text-xs font-bold text-red-600">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-lg border border-sky-100 px-4 py-2 text-sm font-black text-slate-600 disabled:opacity-50">取消</button>
              <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
