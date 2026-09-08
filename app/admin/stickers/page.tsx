import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { AdminStickersTabs } from '@/components/AdminStickersTabs'

export const dynamic = 'force-dynamic'

// Kept for the legacy component's type imports; the legacy review UI is no
// longer mounted here and the unified center owns its list model.
export type StickerRow = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  sort: number
}

export type StickerPackRow = {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  type: 'STATIC' | 'GIF'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  reviewedAt: string | null
  createdAt: string
  creator: { id: string; nickname: string; uid: number }
  stickers: StickerRow[]
}

export default async function AdminStickersPage() {
  await requireAdminPage('/admin/stickers', 'sticker_manage')

  return (
    <main className="admin-mobile-page mx-auto max-w-6xl space-y-7 px-4 py-7 sm:px-5 sm:py-9">
      <section className="rounded-[32px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
        <p className="text-sm font-black tracking-[0.2em] text-brand-700">表情包管理</p>
        <h1 className="mt-2 text-4xl font-black text-brand-950">表情包资料管理</h1>
        <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-slate-600">审核入口已统一到审核中心；本页保留官方表情、排序和排行等非审核管理能力。</p>
        <Link href="/admin/review?type=sticker" className="mt-4 inline-flex bg-brand-950 px-4 py-2 text-sm font-black text-white">进入表情包审核</Link>
      </section>
      <AdminStickersTabs />
    </main>
  )
}
