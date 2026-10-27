import { publicImageUrl } from '@/lib/images'

export const homepageConcertStatuses = ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING'] as const

export type HomepageFeaturedConcertInput = Readonly<{
  homepageFeatured: boolean
  status: string
  title: string | null
  subtitle: string | null
  slug: string | null
  backgroundImageUrl: string | null
  startDate: Date | string | null
  endDate: Date | string | null
}>

export type HomepageFeaturedConcert = Readonly<{
  title: string
  subtitle: string | null
  href: string
  backgroundImageUrl: string | null
  dateRangeLabel: string
}>

function calendarDate(value: Date | string | null): string | null | false {
  if (value === null) return null
  let date: Date
  if (value instanceof Date) {
    date = value
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = new Date(`${value}T00:00:00.000Z`)
  } else {
    date = new Date(value)
  }
  if (!Number.isFinite(date.getTime())) return false
  const label = date.toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && label !== value) return false
  return label
}
export function resolveHomepageFeaturedConcert(event: HomepageFeaturedConcertInput | null | undefined): HomepageFeaturedConcert | null {
  if (!event?.homepageFeatured || !homepageConcertStatuses.includes(event.status as typeof homepageConcertStatuses[number])) return null
  const title = event.title?.trim() || ''
  const slug = event.slug?.trim() || ''
  if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null

  const start = calendarDate(event.startDate)
  const end = calendarDate(event.endDate)
  if (start === false || end === false || (!start && !end) || (start && end && start > end)) return null

  const dateRangeLabel = start && end
    ? start === end ? start.replaceAll('-', '.') : `${start.replaceAll('-', '.')} — ${end.replaceAll('-', '.')}`
    : start ? `${start.replaceAll('-', '.')} 起` : `至 ${end!.replaceAll('-', '.')}`

  return {
    title,
    subtitle: event.subtitle?.trim() || null,
    href: `/concerts/${slug}`,
    backgroundImageUrl: publicImageUrl(event.backgroundImageUrl),
    dateRangeLabel,
  }
}
