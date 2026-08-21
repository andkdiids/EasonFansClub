import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { getBadgeCollection } from '@/lib/badge-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const collection = await getBadgeCollection(guard.user.id, guard.user.id)
  if (!collection) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  return NextResponse.json(collection, { headers: { 'Cache-Control': 'private, no-store' } })
}
