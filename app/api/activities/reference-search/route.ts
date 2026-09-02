import { NextResponse } from 'next/server'
import { searchPublicActivityReferences } from '@/lib/rich-text-references'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/activities/reference-search',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 100).trim()
  if (!query) return NextResponse.json({ activities: [] }, { headers: privateHeaders })

  try {
    const activities = await searchPublicActivityReferences(query)
    return NextResponse.json({ activities }, { headers: privateHeaders })
  } catch (error) {
    console.error('[activities.reference-search]', error)
    return NextResponse.json({ message: '活动搜索暂时不可用' }, { status: 503, headers: privateHeaders })
  }
}
