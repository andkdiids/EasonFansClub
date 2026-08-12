import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPublicMediaUrl } from '@/lib/media-url'
import { StickerPackEditForm } from './StickerPackEditForm'

export const dynamic = 'force-dynamic'

export default async function StickerPackEditPage({ params }: { params: Promise<{ packId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const { packId } = await params
  const pack = await prisma.stickerPack.findUnique({
    where: { id: packId },
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
      updatedAt: true,
      category: true,
      isOfficial: true,
      creatorId: true,
      stickers: {
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, url: true, type: true, sort: true },
      },
    },
  })

  if (!pack || pack.creatorId !== user.id || pack.isOfficial) notFound()

  const initialPack = {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    coverUrl: toPublicMediaUrl(pack.coverUrl),
    type: pack.type,
    status: pack.status,
    rejectionReason: pack.rejectionReason,
    reviewedAt: pack.reviewedAt?.toISOString() ?? null,
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
    category: pack.category,
    stickers: pack.stickers.map((sticker) => ({
      ...sticker,
      url: toPublicMediaUrl(sticker.url) || sticker.url,
    })),
  }

  return (
    <main className="site-page-main flat-page mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-500">
        <Link href="/profile/stickers" className="hover:text-brand-700">← 我的表情包</Link>
        <span aria-hidden>·</span>
        <span>编辑表情包</span>
      </div>
      <header className="rounded-[28px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
        <p className="text-sm font-black tracking-[0.2em] text-brand-700">表情包 · 用户草稿</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">编辑表情包</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600">保留没有修改的表情与原有文件，只处理你需要调整的内容。</p>
      </header>
      <StickerPackEditForm initialPack={initialPack} />
    </main>
  )
}
