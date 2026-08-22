import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { getBadgeCollection, getBadgeProfileSummary } from '@/lib/badge-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const collection = new URL(request.url).searchParams.get('preview') === '1'
    ? await getBadgeProfileSummary(guard.user.id, guard.user.id)
    : await getBadgeCollection(guard.user.id, guard.user.id)
  if (!collection) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  return NextResponse.json(collection, { headers: { 'Cache-Control': 'private, no-store' } })
}
