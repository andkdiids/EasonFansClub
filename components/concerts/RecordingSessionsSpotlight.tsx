import Link from 'next/link'
import type { EventView } from '@/components/concerts/concert-types'
import { ConcertCountdown } from '@/components/concerts/ConcertCountdown'
import { concertLocalDateKey, getConcertTimelineState } from '@/lib/concert-timeline'
import { useServerClock } from '@/components/concerts/useServerClock'

export function RecordingSessionsSpotlight({ event }: Readonly<{ event: EventView }>) {
  const now = useServerClock(event.serverNow, 30_000)
  const timelineState = getConcertTimelineState(event.timeline, new Date(now), event.timezone, event.status)
  let registrationHref: string | null = null
  if (event.registrationEnabled && event.registrationUrl) {
    try {
      const parsed = new URL(event.registrationUrl)
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) registrationHref = parsed.toString()
    } catch { /* Invalid administrator data is hidden fail-closed. */ }
  }
  const first = event.shows[0]?.date
  const last = event.shows[event.shows.length - 1]?.date
  const today = concertLocalDateKey(new Date(now), event.timezone)
  const tonight = event.shows.find((show) => show.date.toISOString().slice(0, 10) === today)
  return <section aria-labelledby="recording-sessions-spotlight" className="border border-white/15 bg-slate-950/75 p-4 text-white shadow-2xl backdrop-blur-md sm:max-w-xl sm:p-5">
    <p className="text-[10px] font-black uppercase tracking-[.24em] text-white/60">限时专题 · Recording Sessions</p>
    <h2 id="recording-sessions-spotlight" className="mt-1 text-lg font-black sm:text-xl">{event.title}</h2>
    {event.subtitle ? <p className="mt-1 text-xs text-white/70">{event.subtitle}</p> : null}
    <p className="mt-2 text-xs text-white/70">{first ? first.toISOString().slice(0, 10).replaceAll('-', '.') : '日期待定'} — {last ? last.toISOString().slice(0, 10).replaceAll('-', '.') : ''} · {event.shows.length} 场</p>
    <p className="mt-2 text-xs font-bold text-white/80">{timelineState.phaseLabel}</p>
    <div className="mt-2"><ConcertCountdown target={timelineState.target} label={timelineState.countdownLabel || '最近活动节点'} serverNow={event.serverNow} /></div>
    {tonight ? <Link href={`/concerts/${event.slug}/shows/${tonight.id}`} className="mt-2 inline-flex min-h-9 items-center border border-white/20 px-2 text-xs font-bold text-white">今晚：{tonight.albumTitle} · {tonight.startTime || '时间待定'} · {tonight.hasTicketCount} 人有票</Link> : null}
    <p className="mt-2 text-xs text-white/70">{event.totalWantToGo} 人想看 · {event.totalHasTicket} 人有票</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {registrationHref ? <a href={registrationHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center bg-white px-3 text-xs font-black text-slate-950">{event.registrationLabel} ↗</a> : null}
      <Link href={`/concerts/${event.slug}#tutorials`} className="inline-flex min-h-10 items-center border border-white/30 px-3 text-xs font-bold text-white">登记教程</Link>
      <Link href={`/concerts/${event.slug}`} className="inline-flex min-h-10 items-center border border-white/30 px-3 text-xs font-bold text-white">进入演唱会专题 →</Link>
    </div>
    <p className="mt-3 text-[10px] leading-4 text-white/50">资料根据用户提供的参考文件整理，未独立核实；请以主办方最新公告为准。</p>
  </section>
}
