export type ConcertDateValue = Date | string

export function concertDateKey(value: ConcertDateValue) {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

export function isConcertWeekend(value: ConcertDateValue) {
  const day = new Date(`${concertDateKey(value)}T00:00:00.000Z`).getUTCDay()
  return day === 0 || day === 6
}

export function filterConcertShows<T extends { date: ConcertDateValue }>(shows: T[], month: string, weekendsOnly: boolean) {
  return shows.filter((show) => concertDateKey(show.date).startsWith(month) && (!weekendsOnly || isConcertWeekend(show.date)))
}

export function getConcertCalendarCells<T extends { date: ConcertDateValue }>(month: string, shows: T[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const firstSunday = new Date(Date.UTC(year, monthNumber - 1, 1 - first.getUTCDay()))
  const showMap = new Map<string, T[]>()
  for (const show of shows) {
    const key = concertDateKey(show.date)
    const existing = showMap.get(key) || []
    existing.push(show)
    showMap.set(key, existing)
  }
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstSunday.getTime() + index * 86_400_000)
    const key = date.toISOString().slice(0, 10)
    return { key, day: date.getUTCDate(), inMonth: date.getUTCMonth() === monthNumber - 1, shows: showMap.get(key) || [] }
  })
}

type TimelineItem = {
  type: string
  title: string
  date: ConcertDateValue
  startsAt?: ConcertDateValue | null
  endsAt?: ConcertDateValue | null
  enabled?: boolean
}

function timeValue(value: ConcertDateValue | null | undefined) {
  return value ? new Date(value).getTime() : null
}

export function concertLocalDateKey(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function timelinePhase(type: string, title: string) {
  switch (type) {
    case 'REGISTRATION_OPEN': return { phaseLabel: '登记即将开放', countdownLabel: title }
    case 'REGISTRATION_CLOSE': return { phaseLabel: '登记抽签进行中', countdownLabel: '登记截止' }
    case 'FIRST_DRAW_RESULT': return { phaseLabel: '等待首轮抽签结果', countdownLabel: title }
    case 'FIRST_PAYMENT_DEADLINE': return { phaseLabel: '首轮中签付款期', countdownLabel: title }
    case 'SECOND_DRAW_RESULT': return { phaseLabel: '等待次轮抽签结果', countdownLabel: title }
    case 'SECOND_PAYMENT_DEADLINE': return { phaseLabel: '次轮中签付款期', countdownLabel: title }
    case 'FIRST_SHOW': return { phaseLabel: '即将迎来首场演出', countdownLabel: title }
    case 'FINAL_SHOW': return { phaseLabel: '演出季即将结束', countdownLabel: title }
    default: return { phaseLabel: title, countdownLabel: title }
  }
}

export function getConcertTimelineState(timeline: readonly TimelineItem[], now: Date, timeZone: string, eventStatus?: string) {
  if (eventStatus === 'ENDED') return { phaseLabel: '活动已结束', countdownLabel: '', target: null, dateOnly: true }
  const enabled = timeline.filter((item) => item.enabled !== false).sort((a, b) => concertDateKey(a.date).localeCompare(concertDateKey(b.date)))
  const today = concertLocalDateKey(now, timeZone)
  const open = enabled.find((item) => item.type === 'REGISTRATION_OPEN')
  const close = enabled.find((item) => item.type === 'REGISTRATION_CLOSE')
  const openAt = timeValue(open?.startsAt || open?.endsAt)
  const closeAt = timeValue(close?.endsAt || close?.startsAt)

  if (openAt !== null && openAt > now.getTime()) {
    return { phaseLabel: '登记即将开放', countdownLabel: open?.title || '登记开放', target: new Date(openAt).toISOString(), dateOnly: false }
  }
  if (open && concertDateKey(open.date) <= today && (!close || closeAt === null || closeAt >= now.getTime() || concertDateKey(close.date) >= today)) {
    return { phaseLabel: '登记抽签进行中', countdownLabel: close ? '登记截止' : '登记抽签截止', target: closeAt !== null && closeAt > now.getTime() ? new Date(closeAt).toISOString() : null, dateOnly: closeAt === null }
  }

  const next = enabled.find((item) => {
    const exact = timeValue(item.startsAt || item.endsAt)
    return exact !== null ? exact > now.getTime() : concertDateKey(item.date) >= today
  })
  if (!next) return { phaseLabel: '活动时间线已结束', countdownLabel: '', target: null, dateOnly: true }
  const exact = timeValue(next.startsAt || next.endsAt)
  const phase = timelinePhase(next.type, next.title)
  const dateOnly = exact === null
  return {
    ...phase,
    phaseLabel: dateOnly && concertDateKey(next.date) === today ? `${phase.phaseLabel} · 今天` : phase.phaseLabel,
    target: exact !== null && exact > now.getTime() ? new Date(exact).toISOString() : null,
    dateOnly,
  }
}
