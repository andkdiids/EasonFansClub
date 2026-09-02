import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { enforceApiRateLimit } from '@/lib/security'
import { listPublicStudioProjects } from '@/lib/studio/public'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limited = await enforceApiRateLimit(request, null, {
    endpoint: '/api/studio/gallery',
    ip: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const params = new URL(request.url).searchParams
  const sort = params.get('sort') === 'hot' ? 'hot' : 'latest'
  const page = Number(params.get('page') || 1)
  const pageSize = Number(params.get('pageSize') || 24)
  const toolSlug = params.get('tool')?.trim() || null
  const viewer = await getCurrentUser().catch(() => null)
  const result = await listPublicStudioProjects({ sort, page, pageSize, toolSlug, viewerId: viewer?.id })
  return NextResponse.json(result, { headers: { 'Cache-Control': viewer ? 'private, no-store' : 'public, max-age=30, stale-while-revalidate=120' } })
}
