import { notFound, redirect } from 'next/navigation'
import { resolveConcertSlugPath } from '@/lib/music-archive'

export const dynamic = 'force-dynamic'

// 兼容层：旧的 /music/live/concerts/<CUID> 直链仍可用，308 跳转到规范的 slug 地址
// /music/live/tours/<tourSlug>/<CITY>/<YYYYMMDD>
export default async function MusicConcertRedirectPage({
  params,
}: {
  params: Promise<{ concertId: string }>
}) {
  const { concertId } = await params
  const path = await resolveConcertSlugPath(concertId)
  if (!path) notFound()
  redirect(`/music/live/tours/${path.tourSlug}/${path.citySlug}/${path.dateSlug}`)
}
