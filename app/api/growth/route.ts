import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { getGrowthOverview } from '@/lib/growth-tasks/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    return NextResponse.json(await getGrowthOverview(guard.user.id), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[growth.overview]', error)
    return NextResponse.json({ ok: false, message: '成长信息暂时无法加载' }, { status: 503 })
  }
}
