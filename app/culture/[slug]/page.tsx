import { notFound, redirect } from 'next/navigation'
import { BackButton } from '@/components/BackButton'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { toPublicMediaUrl } from '@/lib/media-url'

export const dynamic = 'force-dynamic'

const typeText: Record<string, string> = {
  SONG: '歌曲百科',
  ALBUM: '专辑馆',
  FILM: '电影馆',
  LIVE: 'Live 档案馆',
}

export default async function CultureDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const { slug } = await params
  const item = await prisma.cultureItem.findFirst({
    where: { slug, isVisible: true },
    include: {
      CultureComment: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { User: { select: { id: true, nickname: true, Profile: { select: { displayName: true } } } } },
      },
    },
  })
  if (!item) notFound()
  item.coverUrl = toPublicMediaUrl(item.coverUrl)
  const remarkMap = await loadFriendRemarkMap(user.id, item.CultureComment.map((comment) => comment.User.id))

  const facts = [
    ['专辑', item.albumName],
    ['发布时间', item.releaseDate?.toLocaleDateString('zh-CN')],
    ['作词', item.lyricist],
    ['作曲', item.composer],
    ['编曲', item.arranger],
    ['角色 / 城市', item.roleName || item.city],
  ].filter(([, value]) => Boolean(value))

  return (
    <>
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-5">
        <BackButton fallbackHref="/culture" />
        <section className="overflow-hidden rounded-[36px] border border-sky-100 bg-white/82 shadow-xl shadow-sky-900/5">
          <div className="aspect-[16/8] bg-gradient-to-br from-sky-100 via-white to-cyan-50">
            {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="p-7 sm:p-10">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">{typeText[item.type] || item.type}</p>
            <h1 className="mt-3 text-4xl font-black text-brand-950 sm:text-6xl">{item.title}</h1>
            <p className="mt-5 text-base font-bold leading-8 text-slate-600">{item.summary || item.subtitle}</p>
          </div>
        </section>

        {facts.length ? (
          <section className="grid gap-5 md:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-white/78 p-5 shadow-sm">
                <p className="text-xs font-black text-brand-700">{label}</p>
                <p className="mt-2 font-black text-brand-950">{value}</p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="rounded-[28px] bg-white/82 p-6 shadow-sm">
          <h2 className="text-2xl font-black text-brand-950">简介与背景</h2>
          <p className="mt-4 whitespace-pre-wrap text-sm font-bold leading-8 text-slate-600">
            {item.background || item.summary || '后台还没有维护详细介绍。'}
          </p>
          {item.legalExcerpt ? (
            <p className="mt-5 rounded-2xl bg-sky-50 p-5 text-lg font-black leading-9 text-brand-950">{item.legalExcerpt}</p>
          ) : null}
        </section>

        <section className="rounded-[28px] bg-white/82 p-6 shadow-sm">
          <h2 className="text-2xl font-black text-brand-950">评论</h2>
          <div className="mt-4 space-y-3">
            {item.CultureComment.map((comment) => (
              <div key={comment.id} className="rounded-2xl bg-sky-50/80 p-4">
                <p className="text-sm font-black text-brand-950">{resolveFriendDisplayName({
                  viewerId: user.id,
                  targetUserId: comment.User.id,
                  fallbackName: getPublicUserDisplayName(comment.User),
                  remarkMap,
                })}</p>
                <p className="mt-2 text-sm font-bold leading-7 text-slate-600">{comment.content}</p>
              </div>
            ))}
            {!item.CultureComment.length ? <p className="rounded-2xl bg-sky-50/80 p-4 text-sm font-bold text-slate-500">暂无评论。</p> : null}
          </div>
        </section>
      </main>
    </>
  )
}
