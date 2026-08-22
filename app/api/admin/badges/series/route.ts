import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security'
import { createBadgeSeries, listBadgeSeriesForAdmin, parseBadgeSeriesInput } from '@/lib/badge-series'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  return NextResponse.json({ series: await listBadgeSeriesForAdmin() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求无效' }, { status: 400 })
  const parsed = parseBadgeSeriesInput(body as Record<string, unknown>)
  if (parsed.error || !parsed.data) return NextResponse.json({ message: parsed.error || '系列参数无效' }, { status: 400 })
  try {
    const series = await createBadgeSeries({ actorId: guard.user.id, data: parsed.data })
    return NextResponse.json({ series }, { status: 201 })
  } catch (error) {
    const duplicated = error instanceof Error && /P2002|Unique constraint/i.test(error.message)
    return NextResponse.json({ message: duplicated ? '系列 code 已存在' : '系列创建失败' }, { status: duplicated ? 409 : 500 })
  }
}
