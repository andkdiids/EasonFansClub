import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getCurrentUser } from '@/lib/auth'
import { getMyLibraryPacks } from '@/lib/sticker-center'
import { prisma } from '@/lib/prisma'
import { MyStickerLibrary } from './MyStickerLibrary'
import { MarkModerationReadOnMount } from '@/components/MarkModerationReadOnMount'

export const dynamic = 'force-dynamic'

export default async function ProfileStickersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [myLibrary, myUploadsRaw] = await Promise.all([
    getMyLibraryPacks(user.id),
    prisma.stickerPack.findMany({
      where: { creatorId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        rejectionReason: true,
        reviewedAt: true,
        createdAt: true,
        coverUrl: true,
        type: true,
        isOfficial: true,
      },
    }),
  ])

  const myUploads = myUploadsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status as 'PENDING' | 'APPROVED' | 'REJECTED',
    rejectionReason: p.rejectionReason,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    coverUrl: p.coverUrl,
    type: p.type,
    isOfficial: p.isOfficial,
  }))

  return (
    <>
      
      <MarkModerationReadOnMount />
      <main className="site-page-main flat-page mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <p className="text-sm font-black tracking-[0.2em] text-brand-700">表情包 · 个人中心</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">我的表情包</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">
            管理你已添加到表情库的表情包。「取消添加」只移除你个人收藏，不会删除官方表情包本身。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/stickers" className="flat-button-secondary">浏览表情商店</Link>
            <Link href="/stickers/upload" className="flat-button-primary">上传表情包</Link>
          </div>
        </section>

        <MyStickerLibrary initialLibrary={myLibrary} initialUploads={myUploads} />
      </main>
    </>
  )
}
