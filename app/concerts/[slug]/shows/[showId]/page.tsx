import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ConcertShowActions } from '@/components/concerts/ConcertShowActions'
import { ConcertDiscussion } from '@/components/concerts/ConcertDiscussion'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { isConcertMarkVisible, publicConcertMarkUserWhere } from '@/lib/concert-privacy'

export const dynamic = 'force-dynamic'

export default async function ConcertShowPage({ params }: { params: Promise<{ slug: string; showId: string }> }) {
  const [{ slug, showId }, viewer] = await Promise.all([params, getCurrentUser()])
  const show = await prisma.concertShow.findFirst({ where: { id: showId, status: 'SCHEDULED', event: { slug, status: { in: ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING', 'ENDED'] } } }, include: { event: { select: { id: true, title: true, slug: true, timezone: true, allowDiscussion: true, allowMarking: true, status: true } } } }).catch(() => null)
  if (!show) notFound()
  const publicMarkWhere = { eventId: show.eventId, showId, isPublic: true, user: publicConcertMarkUserWhere }
  const [wantCount, ticketCount, viewerMark, viewerReminder, publicMarks] = await Promise.all([
    prisma.concertShowMark.count({ where: { ...publicMarkWhere, wantToGo: true } }),
    prisma.concertShowMark.count({ where: { ...publicMarkWhere, hasTicket: true } }),
    viewer ? prisma.concertShowMark.findUnique({ where: { userId_showId: { userId: viewer.id, showId } }, select: { wantToGo: true, hasTicket: true, isPublic: true } }) : Promise.resolve(null),
    viewer ? prisma.concertReminderSubscription.findFirst({ where: { userId: viewer.id, eventId: show.eventId, targetType: 'SHOW', targetId: showId }, select: { id: true } }) : Promise.resolve(null),
    prisma.concertShowMark.findMany({
      where: { ...publicMarkWhere, OR: [{ wantToGo: true }, { hasTicket: true }] },
      take: 500,
      orderBy: { updatedAt: 'desc' },
      select: { isPublic: true, wantToGo: true, hasTicket: true, user: { select: { status: true, isDeleted: true, uid: true, nickname: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, Profile: { select: { wallVisibility: true, avatarUrl: true } }, UserPrivacySetting: { select: { showConcertHistory: true } } } } },
    }),
  ])
  const visibleMarks = publicMarks.filter(isConcertMarkVisible)
  const songs = Array.isArray(show.songs) ? show.songs.filter((song): song is string => typeof song === 'string') : []
  const dateLabel = new Intl.DateTimeFormat('zh-HK', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(show.date)
  const profileHref = (uid: number) => `/user/${String(uid).padStart(5, '0')}`

  return <main className="site-page-main mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-5 sm:py-8">
    <Link href={`/concerts/${show.event.slug}`} className="text-sm font-bold text-[var(--primary)]">← 返回 {show.event.title}</Link>
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7"><p className="text-xs font-bold text-[var(--foreground-muted)]">{dateLabel} · {show.startTime || '时间待确认'}</p><h1 className="mt-2 text-2xl font-black text-[var(--foreground)] sm:text-4xl">{show.title || show.albumTitle}</h1><p className="mt-2 text-lg font-bold text-[var(--foreground-muted)]">{show.albumTitle}</p>{show.albumYear ? <p className="mt-1 text-sm text-[var(--foreground-muted)]">专辑年份：{show.albumYear}</p> : null}{show.note ? <p className="mt-3 text-sm text-[var(--foreground-muted)]">{show.note}</p> : null}</section>
    <ConcertShowActions slug={show.event.slug} showId={show.id} isAuthenticated={Boolean(viewer)} canMark={show.event.allowMarking && show.event.status !== 'ENDED'} initialMark={viewerMark} wantToGoCount={wantCount} hasTicketCount={ticketCount} reminderEnabled={show.event.status !== 'ENDED'} initialReminder={Boolean(viewerReminder)} />
    <section className="border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6"><h2 className="text-xl font-black text-[var(--foreground)]">参考歌单</h2><p className="mt-1 text-xs text-[var(--foreground-muted)]">资料来自用户提供的本地参考页面，未经独立核验；以主办方公告为准。</p>{songs.length ? <ol className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">{songs.map((song, index) => <li key={`${index}-${song}`} className="border-b border-[var(--border)] py-2 text-sm text-[var(--foreground)]"><span className="mr-2 text-xs text-[var(--foreground-muted)]">{String(index + 1).padStart(2, '0')}</span>{song}</li>)}</ol> : <p className="mt-4 text-sm text-[var(--foreground-muted)]">歌单尚未补充。</p>}</section>
    <section className="border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6"><h2 className="text-xl font-black text-[var(--foreground)]">参与名单</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h3 className="text-sm font-bold text-[var(--foreground)]">想看 · {wantCount}</h3><ul className="mt-2 space-y-2">{visibleMarks.filter((item) => item.wantToGo).map((item) => <li key={`want-${item.user.uid}`}><Link href={profileHref(item.user.uid)} className="flex items-center gap-2 text-sm text-[var(--primary)]"><span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-[var(--background)]">{publicImageUrl(item.user.Profile?.avatarUrl || item.user.avatarUrl) ? <Image src={publicImageUrl(item.user.Profile?.avatarUrl || item.user.avatarUrl)!} alt="" width={32} height={32} className="h-full w-full object-cover" unoptimized /> : 'E'}</span>{getPublicUserDisplayName(item.user)} · UID {item.user.uid}</Link></li>)}</ul>{!visibleMarks.some((item) => item.wantToGo) ? <p className="mt-2 text-xs text-[var(--foreground-muted)]">还没有公开名单。</p> : null}</div><div><h3 className="text-sm font-bold text-[var(--foreground)]">有票 · {ticketCount}</h3><ul className="mt-2 space-y-2">{visibleMarks.filter((item) => item.hasTicket).map((item) => <li key={`ticket-${item.user.uid}`}><Link href={profileHref(item.user.uid)} className="flex items-center gap-2 text-sm text-[var(--primary)]"><span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-[var(--background)]">{publicImageUrl(item.user.Profile?.avatarUrl || item.user.avatarUrl) ? <Image src={publicImageUrl(item.user.Profile?.avatarUrl || item.user.avatarUrl)!} alt="" width={32} height={32} className="h-full w-full object-cover" unoptimized /> : 'E'}</span>{getPublicUserDisplayName(item.user)} · UID {item.user.uid}</Link></li>)}</ul>{!visibleMarks.some((item) => item.hasTicket) ? <p className="mt-2 text-xs text-[var(--foreground-muted)]">还没有公开名单。</p> : null}</div></div></section>
    {show.event.allowDiscussion ? <ConcertDiscussion slug={show.event.slug} showId={show.id} isAuthenticated={Boolean(viewer)} canComment={show.event.status !== 'ENDED'} /> : null}
  </main>
}
