import { requireAdminPage } from '@/components/AdminAccess'

import { prisma } from '@/lib/prisma'
import { AdminStickersTabs } from '@/components/AdminStickersTabs'

export const dynamic = 'force-dynamic'

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

  const rawPacks = await prisma.stickerPack.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      description: true,
      coverUrl: true,
      type: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
      creator: { select: { id: true, nickname: true, uid: true } },
      stickers: {
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, url: true, type: true, sort: true },
      },
    },
  })

  const initialPacks: StickerPackRow[] = rawPacks.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    coverUrl: p.coverUrl,
    type: p.type,
    status: p.status,
    rejectionReason: p.rejectionReason,
    reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    creator: p.creator,
    stickers: p.stickers,
  }))

  return (
    <>
      
      <main className="admin-mobile-page mx-auto max-w-6xl space-y-7 px-4 py-7 sm:px-5 sm:py-9">
        <section className="rounded-[32px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <p className="text-sm font-black tracking-[0.2em] text-brand-700">表情包 · 审核中心</p>
          <h1 className="mt-2 text-4xl font-black text-brand-950">表情包审核</h1>
          <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-slate-600">
            审核用户提交的表情包合集。预览表情后通过或拒绝；静态合集仅含静态图，动态合集仅含 GIF 动图。
          </p>
        </section>
        <AdminStickersTabs initialPacks={initialPacks} />
      </main>
    </>
  )
}
