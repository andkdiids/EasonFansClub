import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { deleteUndercoverWordPair, getUndercoverWordPairAdmin, updateUndercoverWordPair } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const { id } = await params
    await updateUndercoverWordPair(id, body || {})
    return undercoverOk({ row: await getUndercoverWordPairAdmin(id) })
  } catch (error) {
    return undercoverError(error, '更新卧底巨星词组失败。')
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guard.response
  try {
    const { id } = await params
    await deleteUndercoverWordPair(id)
    return undercoverOk({ deleted: true })
  } catch (error) {
    return undercoverError(error, '删除卧底巨星词组失败。')
  }
}
