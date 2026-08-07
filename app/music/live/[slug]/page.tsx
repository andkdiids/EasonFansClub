import Link from 'next/link'
import { ConcertCover } from '@/components/music/ConcertCover'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { ConcertCategoryCards } from '@/components/music/ConcertCategoryCards'
import { formatLiveDateRange } from '@/lib/music-live'
import { firstPosterUrl, resolveConcertPoster } from '@/lib/music-concert-poster'
import { generateArchiveSlug } from '@/lib/music-slug'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { getSiteAppearance } from '@/lib/site-config'
import {
  getEnabledConcertCategories,
  isReservedCategorySlug,
  MUSIC_CONCERT_CATEGORY_SLUG_TO_ENUM,
  type ConcertCategoryConfig,
} from '@/lib/music-concert-category'

export const dynamic = 'force-dynamic'

// 核心分类即使没有数据库分类记录也允许访问（与 MusicTour.category 枚举绑定）。
const FALLBACK_CATEGORY_META: Record<string, { name: string; eyebrow: string }> = {
  main: { name: '大型演唱会', eyebrow: 'MAIN CONCERTS' },
  small: { name: '小型企划', eyebrow: 'SPECIAL PROJECTS' },
  guest: { name: '嘉宾现场', eyebrow: 'GUEST APPEARANCES' },
}

export default async function ConcertCategoryDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sessionUser = await getCurrentUser().catch(() => null)
  const isAdmin = Boolean(sessionUser) && (sessionUser?.role === 'ADMIN' || sessionUser?.role === 'SUPER_ADMIN')
  const [config, enabledCategories] = await Promise.all([
    getSiteAppearance(),
    getEnabledConcertCategories().catch(() => []),
  ])

  // 调试日志：确认路由命中、收到的 slug，以及分类解析结果（便于定位线上 404）。
  console.log('[ConcertCategoryDetail] params.slug =', JSON.stringify(slug), '| isAdmin =', isAdmin)

  // 解析分类：优先后台已启用分类；核心分类即使没有 DB 记录也允许访问（与 enum 绑定）。
  const dbCategory = enabledCategories.find((category) => category.slug === slug)
  const isReserved = isReservedCategorySlug(slug)
  const category: ConcertCategoryConfig | null =
    dbCategory ?? (isReserved ? { id: slug, name: FALLBACK_CATEGORY_META[slug]?.name ?? slug, slug, sortOrder: 0, enabled: true } : null)

  console.log('[ConcertCategoryDetail] resolved category =', category ? { id: category.id, slug: category.slug, name: category.name, isReserved } : null, '| enabledCategories =', enabledCategories.map((c) => c.slug))

  // 找不到分类（非核心 slug 且无 DB 记录）：渲染友好空态，不直接 404。
  if (!category) {
    return (
      <MusicArchiveShell backgroundVisual={config.heroVisuals.music}>
        <BackBar />
        <EmptyState slug={slug} categories={enabledCategories} />
      </MusicArchiveShell>
    )
  }

  // 查询该分类下公开巡演。核心分类同时兼容旧 enum 数据（categoryId 为空时按枚举归类），
  // 查询覆盖所有公开类型，不写死 CONCERT / MAIN。
  const tourWhere: Record<string, unknown> = isAdmin ? {} : { status: 'PUBLISHED' }
  if (isReserved) {
    const enumValue = MUSIC_CONCERT_CATEGORY_SLUG_TO_ENUM[slug]
    tourWhere.OR = [{ categoryId: category.id }, { categoryId: null, category: enumValue }]
  } else {
    tourWhere.categoryId = category.id
  }

  const tours = await prisma.musicTour.findMany({
    where: tourWhere,
    orderBy: [{ startDate: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      subtitle: true,
      posterUrl: true,
      startDate: true,
      endDate: true,
      category: true,
      categoryId: true,
      status: true,
      MusicConcert: {
        where: isAdmin ? {} : { status: 'PUBLISHED' },
        orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { city: true, posterUrl: true },
      },
      _count: { select: { MusicConcert: isAdmin ? {} : { where: { status: 'PUBLISHED' } } } },
    },
  })
  const resolvedTours = tours.map(({ MusicConcert, _count, ...tour }) => ({
    ...tour,
    ...resolveConcertPoster({ posterUrl: tour.posterUrl, cityPosterUrl: firstPosterUrl(MusicConcert.map((concert) => concert.posterUrl)) }),
    concertCount: _count.MusicConcert,
    cityCount: new Set(MusicConcert.map((concert) => concert.city)).size,
  }))

  // 调试日志：确认该分类下查询到的巡演（events）数量。
  console.log('[ConcertCategoryDetail] events(tours) count =', resolvedTours.length, '| slug =', JSON.stringify(slug))

  return (
    <MusicArchiveShell backgroundVisual={config.heroVisuals.music}>
      <BackBar />
      <header className="py-10 sm:py-12">
        <p className="text-xs font-black tracking-[0.24em] text-sky-300/70">{FALLBACK_CATEGORY_META[slug]?.eyebrow || 'CONCERT CATEGORY'}</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">{category.name}</h1>
        <p className="mt-4 text-sm font-bold text-slate-300/60">分类下收录的巡演与现场企划。</p>
      </header>
      <section className="mb-12" aria-label="分类导航">
        <ConcertCategoryCards categories={enabledCategories} activeSlug={slug} />
      </section>
      {!resolvedTours.length ? (
        <EmptyState slug={slug} categories={enabledCategories} />
      ) : (
        <section aria-labelledby="category-tours-title">
          <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">TOUR ARCHIVE</p>
          <h2 id="category-tours-title" className="mt-2 text-2xl font-black text-white sm:text-3xl">巡演档案</h2>
          <div className="mt-7 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {resolvedTours.map((tour) => {
              const href = `/music/live/tours/${generateArchiveSlug(tour.name)}${isAdmin && tour.status !== 'PUBLISHED' ? '?preview=1' : ''}`
              return (
                <Link key={tour.id} href={href} className="group min-w-0 overflow-hidden border border-white/10 bg-white/[0.055] transition hover:border-sky-300/30 hover:bg-white/[0.09]">
                  <div className="relative aspect-square bg-[#0b2038]">
                    <ConcertCover resolvedPosterUrl={tour.resolvedPosterUrl} alt={`${tour.name}巡演海报`} sizes="(max-width: 640px) 50vw, 25vw" />
                    {isAdmin && tour.status !== 'PUBLISHED' ? <span className="absolute left-2 top-2 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-black text-amber-950">草稿</span> : null}
                  </div>
                  <div className="p-5">
                    <h3 className="break-words text-xl font-black text-white">{tour.name}</h3>
                    {tour.subtitle ? <p className="mt-2 break-words text-sm font-bold text-slate-300/65">{tour.subtitle}</p> : null}
                    <p className="mt-4 text-xs font-black text-sky-200/60">{formatLiveDateRange(tour.startDate, tour.endDate)}</p>
                    <p className="mt-2 text-xs font-bold text-slate-300/55">{tour.concertCount} 场 · {tour.cityCount} 个城市</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </MusicArchiveShell>
  )
}

function BackBar() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/music/concerts" className="text-sm font-black text-sky-300/80">← 返回完整档案</Link>
      <Link href="/music/live" className="border border-sky-200/20 bg-sky-200/[0.07] px-4 py-2 text-sm font-black text-sky-100">全部巡演 →</Link>
    </div>
  )
}

function EmptyState({ slug, categories }: { slug: string; categories: ConcertCategoryConfig[] }) {
  return (
    <section className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.05] px-6 py-16 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-sky-300/20 bg-sky-300/[0.08] text-2xl font-black text-sky-200/70">♪</div>
      <h2 className="mt-6 text-2xl font-black text-white">该分类暂无内容</h2>
      <p className="mt-3 max-w-xl text-sm font-bold text-slate-300/65">未找到分类「{slug}」对应的内容，或该分类下还没有已发布的巡演。你可以返回完整档案浏览其它分类。</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/music/concerts" className="rounded-full bg-sky-300 px-5 py-2.5 text-sm font-black text-sky-950">返回完整档案</Link>
        <Link href="/music/live" className="rounded-full border border-sky-200/20 bg-sky-200/[0.07] px-5 py-2.5 text-sm font-black text-sky-100">浏览全部巡演</Link>
      </div>
      {categories.length ? (
        <div className="mt-12">
          <p className="text-xs font-black tracking-[0.2em] text-sky-300/55">其它分类</p>
          <div className="mt-4">
            <ConcertCategoryCards categories={categories} />
          </div>
        </div>
      ) : null}
    </section>
  )
}
