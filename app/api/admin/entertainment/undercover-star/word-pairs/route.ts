import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'
import { createUndercoverWordPair, listUndercoverWordPairs } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/entertainment/undercover-star/word-pairs:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  const params = new URL(request.url).searchParams
  const rawPage = Number(params.get('page') || 1)
  const rawPageSize = Number(params.get('pageSize') || 20)
  try {
    return undercoverOk(await listUndercoverWordPairs({
      page: Number.isSafeInteger(rawPage) ? Math.min(10_000, Math.max(rawPage, 1)) : 1,
      pageSize: Number.isSafeInteger(rawPageSize) ? Math.min(Math.max(rawPageSize, 1), 50) : 20,
      query: sanitizeText(params.get('q'), 100),
      category: params.get('category') || undefined,
      difficulty: params.get('difficulty') || undefined,
    }))
  } catch (error) {
    return undercoverError(error, '暂时无法加载卧底巨星词库。')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/entertainment/undercover-star/word-pairs:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  })
  if (limited) return limited
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const created = await createUndercoverWordPair({
      civilianWord: body?.civilianWord,
      undercoverWord: body?.undercoverWord,
      category: body?.category,
      difficulty: body?.difficulty,
      enabled: body?.enabled,
    })
    const result = await listUndercoverWordPairs({ query: created.civilianWord, page: 1, pageSize: 50 })
    const row = result.rows.find((item) => item.id === created.id)
    return undercoverOk({ row }, { status: 201 })
  } catch (error) {
    return undercoverError(error, '保存卧底巨星词组失败。')
  }
}
