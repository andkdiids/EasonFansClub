import { NextResponse } from 'next/server'
import { getPersonalRanking, parsePersonalRankingType, PersonalRankingError, reorderPersonalRanking } from '@/lib/personal-ranking'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const type = parsePersonalRankingType(body?.type)
  const revision = Number(body?.revision)
  const itemIds = Array.isArray(body?.items) ? body.items.map((item: unknown) => sanitizeText(typeof item === 'object' && item ? (item as { id?: unknown }).id : '', 100)).filter(Boolean) : []
  if (!Number.isSafeInteger(revision) || revision < 0) return NextResponse.json({ code: 'INVALID_ORDER', message: '排序版本无效' }, { status: 400 })
  try {
    return NextResponse.json(await reorderPersonalRanking(guard.user.id, type, itemIds, revision))
  } catch (error) {
    if (error instanceof PersonalRankingError) {
      if (error.code === 'STALE_REVISION') {
        const latest = await getPersonalRanking(guard.user.id, type)
        return NextResponse.json({ code: error.code, message: error.message, latestRevision: latest.revision, latest }, { status: error.status })
      }
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    }
    console.error('[personal-ranking.order]', error)
    return NextResponse.json({ message: '保存榜单顺序失败，请稍后重试' }, { status: 503 })
  }
}
