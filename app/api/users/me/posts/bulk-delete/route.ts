import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { deletePost } from '@/lib/post-deletion'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'
import { formatUid } from '@/lib/uid'
import { HOME_FEATURED_POSTS_CACHE_TAG } from '@/lib/home-data'

export const dynamic = 'force-dynamic'

const MAX_BULK_SIZE = 100

/**
 * 用户批量删除「自己的」帖子。
 * - 服务端重新校验登录态（requireUser）。
 * - 先一次性校验：批量里每一篇都必须存在且 authorId === 当前用户。
 *   只要有一篇不属于自己（或不存在），整批拒绝并返回 403，绝不删除任何帖子。
 * - 通过校验后复用统一 deletePost 服务（canManagePosts=false，不写管理员审计，
 *   与个人主页单帖删除语义一致）。返回真实的成功 / 失败数量。
 */
export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  let body: unknown
  try {
    body = await request.json().catch(() => null)
  } catch {
    return NextResponse.json({ ok: false, message: '请求体无法解析' }, { status: 400 })
  }

  const rawPostIds = (body as { postIds?: unknown })?.postIds
  if (!Array.isArray(rawPostIds)) {
    return NextResponse.json({ ok: false, message: 'postIds 必须是数组' }, { status: 400 })
  }
  const postIds = rawPostIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  if (postIds.length === 0) {
    return NextResponse.json({ ok: false, message: '请至少选择一篇帖子' }, { status: 400 })
  }
  if (postIds.length > MAX_BULK_SIZE) {
    return NextResponse.json({ ok: false, message: `单次最多删除 ${MAX_BULK_SIZE} 篇帖子` }, { status: 400 })
  }

  // 一次性取出所有请求帖子的归属，便于整批校验。
  const owned = await prisma.post.findMany({
    where: { id: { in: postIds }, isDeleted: false },
    select: { id: true, authorId: true },
  })
  const ownedById = new Map(owned.map((post) => [post.id, post.authorId]))
  const notOwned = postIds.filter((id) => ownedById.get(id) !== guard.user!.id)
  if (notOwned.length > 0) {
    // 混入他人帖子（或不存在的帖子）时整批拒绝，删除 0 篇，避免越权。
    return NextResponse.json(
      { ok: false, code: 'POST_DELETE_FORBIDDEN', message: '只能删除自己发布的帖子', rejectedIds: notOwned },
      { status: 403 },
    )
  }

  const deletedIds: string[] = []
  const errors: Array<{ postId: string; code: string; message: string }> = []

  for (const postId of postIds) {
    try {
      await deletePost({ postId, actor: guard.user, canManagePosts: false })
      deletedIds.push(postId)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'POST_DELETE_FAILED'
      errors.push({ postId, code, message: code === 'POST_ALREADY_DELETED' ? '帖子已删除' : '删除失败' })
    }
  }

  try {
    revalidatePath('/forum')
    revalidatePath('/community')
    revalidatePath('/trending')
    revalidatePath('/rankings')
    revalidatePath('/search')
    revalidatePath('/profile')
    revalidatePath(`/user/${formatUid(guard.user.uid)}`)
    revalidateTag('trending-posts')
    revalidateTag(HOME_FEATURED_POSTS_CACHE_TAG)
  } catch (error) {
    console.error('[users.me.posts.bulk-delete.cache]', { userId: guard.user.id, error: error instanceof Error ? error.message : String(error) })
  }

  return NextResponse.json({
    ok: true,
    deleted: deletedIds.length,
    failed: errors.length,
    deletedIds,
    errors,
  })
}
