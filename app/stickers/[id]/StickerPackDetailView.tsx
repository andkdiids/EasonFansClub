'use client'

import { useState } from 'react'
import type { StorePackDetail } from '@/lib/sticker-center'

export function StickerPackDetailView({ pack }: { pack: StorePackDetail }) {
  const [added, setAdded] = useState(pack.added)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    const optimistic = !added
    setAdded(optimistic)
    setBusy(true)
    try {
      const res = await fetch(`/api/stickers/store/${pack.id}/add`, {
        method: optimistic ? 'POST' : 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || '操作失败')
      if (optimistic && data.added !== undefined) setAdded(Boolean(data.added))
    } catch (err) {
      setAdded(pack.added)
      alert(err instanceof Error ? err.message : '网络错误')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`flat-button-primary disabled:opacity-50 ${added ? '!bg-white !text-slate-600 !border-slate-300' : ''}`}
      >
        {busy ? '处理中…' : added ? '已添加 ✓' : '添加表情包'}
      </button>
      <p className="text-xs font-bold text-slate-400">
        {added ? '已加入你的表情库，可在私信和评论中发送' : '添加到表情库后即可在私信和评论发送'}
      </p>
    </div>
  )
}
