import { NextResponse } from 'next/server'
import { refreshProfileCompletion, getGrowthOverview } from '@/lib/growth-tasks/service'
import { requireUser } from '@/lib/security'

export async function POST() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    await refreshProfileCompletion(guard.user.id)
    return NextResponse.json(await getGrowthOverview(guard.user.id), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[growth.refresh]', error)
    return NextResponse.json({ ok: false, message: '资料状态刷新失败' }, { status: 503 })
  }
}
