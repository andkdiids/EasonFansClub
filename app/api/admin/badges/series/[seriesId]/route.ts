import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security'
import { deleteBadgeSeriesSafely, parseBadgeSeriesInput, updateBadgeSeries } from '@/lib/badge-series'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ seriesId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { seriesId } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求无效' }, { status: 400 })
  const parsed = parseBadgeSeriesInput(body as Record<string, unknown>, true)
  if (parsed.error || !parsed.data || !Object.keys(parsed.data).length) return NextResponse.json({ message: parsed.error || '没有可更新的字段' }, { status: 400 })
  try {
    const series = await updateBadgeSeries({ actorId: guard.user.id, seriesId, data: parsed.data })
    return NextResponse.json({ series })
  } catch (error) {
    const duplicated = error instanceof Error && /P2002|Unique constraint/i.test(error.message)
    return NextResponse.json({ message: duplicated ? '系列 code 已存在' : '系列不存在或更新失败' }, { status: duplicated ? 409 : 404 })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { seriesId } = await context.params
  try {
    const result = await deleteBadgeSeriesSafely({ actorId: guard.user.id, seriesId })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '系列删除失败' }, { status: 404 })
  }
}
