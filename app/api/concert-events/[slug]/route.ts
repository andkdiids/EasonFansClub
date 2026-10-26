import { NextResponse } from 'next/server'
import { resolveRequestAuth } from '@/lib/security'
import { getPublicConcertEvent, safeEventSlug } from '@/lib/concert-events'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const { slug: rawSlug } = await params
  const slug = safeEventSlug(rawSlug)
  if (!slug) return NextResponse.json({ message: '专题不存在' }, { status: 404 })
  try {
    const event = await getPublicConcertEvent(slug, auth.user?.id)
    if (!event) return NextResponse.json({ message: '专题不存在' }, { status: 404 })
    return NextResponse.json({ event }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
  } catch (error) {
    console.error('[concert-events.get]', { slug, errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ message: '专题暂时无法加载，请稍后重试' }, { status: 503 })
  }
}
