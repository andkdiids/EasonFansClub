'use client'

import { useState } from 'react'
import { StickerReviewManager } from '@/app/admin/stickers/StickerReviewManager'
import { StickerAdminManager } from '@/components/StickerAdminManager'
import type { StickerPackRow } from '@/app/admin/stickers/page'

type TabKey = 'review' | 'manage'

export function AdminStickersTabs({ initialPacks }: { initialPacks: StickerPackRow[] }) {
  const [tab, setTab] = useState<TabKey>('review')
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('review')}
          className={`rounded-full px-4 py-1.5 text-sm font-black transition ${
            tab === 'review' ? 'bg-brand-600 text-white' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200 hover:bg-white'
          }`}
        >
          用户合集审核
        </button>
        <button
          type="button"
          onClick={() => setTab('manage')}
          className={`rounded-full px-4 py-1.5 text-sm font-black transition ${
            tab === 'manage' ? 'bg-brand-600 text-white' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200 hover:bg-white'
          }`}
        >
          表情管理 / 官方 / 排行
        </button>
      </div>
      {tab === 'review' ? <StickerReviewManager initialPacks={initialPacks} /> : <StickerAdminManager />}
    </div>
  )
}
