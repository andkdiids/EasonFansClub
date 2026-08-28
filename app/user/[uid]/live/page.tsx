import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { formatLiveDate } from '@/lib/music-live'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { normalizedCityKey } from '@/lib/music-personal-live'
import { myLivePhotoOrderBy, myLivePhotoSelect, serializeMyLivePhotos } from '@/lib/my-live-photo-data'
import { MyLivePhotoPanel } from '@/components/music/live/MyLivePhotoPanel'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { parseUidParam } from '@/lib/uid'
import { getProfileVisibility } from '@/lib/user-privacy'

export const dynamic = 'force-dynamic'

export default async function PublicUserLivePage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  if (numericUid === null || numericUid <= 0) notFound()
  const viewer = await getCurrentUser()
  if (viewer?.uid === numericUid) redirect('/music/live/me')
  const [user, config] = await Promise.all([
    prisma.user.findFirst({
      where: { uid: numericUid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: {
        id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } },
      },
    }),
    getSiteAppearance(),
  ])
  if (!user || !user.Profile) notFound()
  const visibility = await getProfileVisibility(user.id, viewer?.id)
  if (!visibility.isSelf && !visibility.settings.showConcertHistory) notFound()
  const records = await prisma.userMusicConcert.findMany({
    where: { userId: user.id, isPublic: true, MusicConcert: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } } },
    orderBy: [{ MusicConcert: { concertDate: 'desc' } }, { createdAt: 'desc' }],
    take: 100,
    select: {
      mood: true,
      MyLivePhoto: { orderBy: myLivePhotoOrderBy, select: myLivePhotoSelect },
      MusicConcert: {
        select: {
          id: true, title: true, concertDate: true, city: true, venue: true, sessionNumber: true, stageType: true,
          MusicTour: { select: { id: true, name: true } },
        },
      },
    },
  })
  const name = getPublicUserDisplayName(user)
  const tours = new Set(records.map((record) => record.MusicConcert.MusicTour.id))
  const cities = new Set(records.map((record) => normalizedCityKey(record.MusicConcert.city)).filter(Boolean))
  return <MusicArchiveShell maxWidth="max-w-5xl" backgroundVisual={config.heroVisuals.music}>
    <Link href={`/user/${uid}`} className="text-sm font-black text-sky-300/80">← 返回{name}的主页</Link>
    <header className="py-10 sm:py-14"><h1 className="break-words text-4xl font-black text-white sm:text-6xl">{name}公开的现场记录</h1></header>
    <dl className="grid grid-cols-3 border-y border-white/10 bg-white/[0.04]">
      {[['公开场次', records.length], ['经历巡演', tours.size], ['去过城市', cities.size]].map(([label, value]) => <div key={String(label)} className="border-r border-white/10 p-4 last:border-r-0 sm:p-6"><dt className="text-xs font-bold text-slate-400">{label}</dt><dd className="mt-2 text-3xl font-black text-white">{value}</dd></div>)}
    </dl>
    {!records.length ? <section className="mt-8 border border-white/10 bg-white/[0.04] p-7"><p className="font-bold text-slate-300">TA暂时没有公开现场记录。</p></section> : <section className="mt-10 space-y-3" aria-label="公开观演时间线">{records.map((record) => {
      const concert = record.MusicConcert
      return <article key={concert.id} className="grid min-w-0 gap-3 border-l-2 border-sky-300/40 bg-white/[0.045] p-5 hover:bg-white/[0.08]"><Link href={buildConcertSlugPath(concert.MusicTour.name, concert.city, concert.concertDate, concert.stageType)} className="grid min-w-0 gap-2 sm:grid-cols-[140px_minmax(0,1fr)]"><time className="text-sm font-black text-sky-200">{formatLiveDate(concert.concertDate)}</time><div className="min-w-0"><h2 className="break-words text-xl font-black text-white">{concert.city}{concert.sessionNumber ? ` · ${concert.sessionNumber}` : ''}</h2><p className="mt-1 break-words text-sm text-slate-300/70">{concert.venue || '场馆待整理'} · {concert.MusicTour.name}</p>{record.mood ? <p className="mt-2 text-sm font-bold text-sky-200/70">当晚心情：{record.mood}</p> : null}</div></Link><MyLivePhotoPanel photos={serializeMyLivePhotos(record.MyLivePhoto)} /></article>
    })}</section>}
  </MusicArchiveShell>
}
