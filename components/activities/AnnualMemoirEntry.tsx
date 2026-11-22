import Link from 'next/link'
import { publicImageUrl } from '@/lib/images'
import type { readMemoirEntry } from '@/lib/annual-memoir-entry'
import { AnnualMemoirActions } from './AnnualMemoirActions'

export function AnnualMemoirEntry({ entry, description }: {
  entry: NonNullable<Awaited<ReturnType<typeof readMemoirEntry>>>; description?: string
}) {
  const { config, reservation, state, hasSnapshot, ended, serverNow, reservationBadgeName } = entry
  if (!state.visible && !hasSnapshot) return null
  const href = '/activities/' + encodeURIComponent(config.activityId)
  const cover = publicImageUrl(config.activity.coverUrl)
  const detail = description !== undefined
  const Heading = detail ? 'h1' : 'h2'
  return <article className="grid min-w-0 [overflow-wrap:anywhere] border border-[#d9bdbb] bg-[#f7eddf] text-[#43253a] md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
    <div className="relative min-w-0 bg-[radial-gradient(ellipse_at_80%_32%,#ba8996,transparent_52%),radial-gradient(ellipse_at_20%_60%,#754b6b,transparent_72%),linear-gradient(135deg,#3a233a,#69384c)] px-4 py-5 sm:px-7 md:flex md:flex-col md:justify-center">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="mx-auto block h-auto max-h-72 w-full max-w-full rounded-sm object-contain" />
      ) : <p className="py-10 text-center font-serif text-2xl text-[#fff1df]">{config.year} 年度回忆录</p>}
    </div>
    <div className="min-w-0 space-y-4 break-words px-4 py-5 sm:px-7 sm:py-8">
      <p className="font-semibold text-[#784b5d]">私家E院 · {config.year} 年度回忆录</p>
      <Heading className="font-serif text-[clamp(1.65rem,6.5vw,2.75rem)] font-semibold leading-tight">{config.activity.title}</Heading>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#5c4450]">{description?.trim() || '这一年，属于你的故事，正在慢慢成熟。'}</p>
      <AnnualMemoirActions
        href={href} title={config.activity.title} serverNow={serverNow} reportOpens={config.reportOpensAt.getTime()}
        reservationCloses={config.reservationClosesAt.getTime()} endsAt={config.endsAt.getTime()}
        canReserve={state.canReserve} canGenerate={state.canGenerate} hasSnapshot={hasSnapshot} ended={ended}
        reservation={reservation && { points: reservation.points, badgeId: reservation.badgeId,
          pointsGrantedAt: reservation.pointsGrantedAt?.toISOString() ?? null, badgeGrantedAt: reservation.badgeGrantedAt?.toISOString() ?? null }}
        points={config.reservationPoints} badge={reservationBadgeName} />
      {!detail && <Link href={href} className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">活动详情</Link>}
    </div>
  </article>
}
