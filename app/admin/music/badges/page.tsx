import { requireAdminPage } from '@/components/AdminAccess'

import { prisma } from '@/lib/prisma'
import { toPublicMediaUrl } from '@/lib/media-url'
import { ConcertBadgeManager } from './ConcertBadgeManager'

export const dynamic = 'force-dynamic'

type BadgeRow = {
  id: string
  name: string
  slug: string
  description: string | null
  iconUrl: string | null
  isActive: boolean
  category: 'SYSTEM' | 'BIRTHDAY' | 'CONCERT'
  musicTourId: string | null
  musicTour: { id: string; name: string } | null
}

export default async function AdminConcertBadgesPage() {
  const user = await requireAdminPage('/admin/music/badges', 'music_manage')

  const badges = (await prisma.badge.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      iconUrl: true,
      isActive: true,
      category: true,
      musicTourId: true,
      musicTour: { select: { id: true, name: true } },
    },
  })) as BadgeRow[]
  badges.forEach((badge) => { badge.iconUrl = toPublicMediaUrl(badge.iconUrl) })

  const tours = await prisma.musicTour.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  })

  return (
    <>
      
      <main className="admin-mobile-page mx-auto max-w-6xl space-y-7 px-4 py-7 sm:px-5 sm:py-9">
        <section className="rounded-[32px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <p className="text-sm font-black tracking-[0.2em] text-brand-700">EasMusic · 演唱会徽章</p>
          <h1 className="mt-2 text-4xl font-black text-brand-950">演唱会纪念徽章</h1>
          <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-slate-600">
            为巡演创建纪念徽章，用户把对应场次加入「我的现场」后会自动获得。徽章图标自动转为 WebP 存储。
          </p>
        </section>
        <ConcertBadgeManager initialBadges={badges} tours={tours} />
      </main>
    </>
  )
}
