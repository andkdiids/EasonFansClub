import { NextResponse } from 'next/server'
import { createAdminActionAudit } from '@/lib/admin-audit'
import { deletePost } from '@/lib/post-deletion'
import { prisma } from '@/lib/prisma'
import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/security'
import { HOME_FEATURED_POSTS_CACHE_TAG } from '@/lib/home-data'

export const dynamic = 'force-dynamic'

const MAX_BULK_SIZE = 100

/**
 * 管理员批量删除帖子。
 * - 复用统一 deletePost 服务（软删除 + 板块帖子数重算 + 归属校验 + 幂等）。
 * - 服务端重新校验 post_manage 权限（requireAdmin），并逐条校验 postId 合法且帖子存在。
 * - 每篇删除均写入独立的 DELETE_POST 审计（沿用既有单帖审计类型，不新增 BATCH_DELETE）。
 * - 返回真实的成功 / 失败数量，部分失败不影响其余帖子。
 */
export async function POST(request: Request) {
  const guard = await requireAdmin('post_manage')
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

  const deletedIds: string[] = []
  const errors: Array<{ postId: string; code: string; message: string }> = []

  for (const postId of postIds) {
    try {
      const result = await deletePost({ postId, actor: guard.user, canManagePosts: true, reason: '管理员批量删除' })
      try {
        await createAdminActionAudit(prisma, result.audit)
      } catch (auditError) {
        console.error('[admin.posts.bulk-delete.audit]', { postId, userId: guard.user.id, error: auditError instanceof Error ? auditError.message : String(auditError) })
      }
      deletedIds.push(postId)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'POST_DELETE_FAILED'
      errors.push({ postId, code, message: code === 'POST_NOT_FOUND' || code === 'POST_ALREADY_DELETED' ? '帖子不存在或已删除' : '删除失败' })
    }
  }

  try {
    revalidatePath('/forum')
    revalidatePath('/community')
    revalidatePath('/trending')
    revalidatePath('/rankings')
    revalidatePath('/search')
    revalidatePath('/admin/posts/review')
    revalidatePath('/user/[uid]', 'page')
    revalidateTag('trending-posts')
    revalidateTag(HOME_FEATURED_POSTS_CACHE_TAG)
  } catch (error) {
    console.error('[admin.posts.bulk-delete.cache]', { userId: guard.user.id, error: error instanceof Error ? error.message : String(error) })
  }

  return NextResponse.json({
    ok: true,
    deleted: deletedIds.length,
    failed: errors.length,
    deletedIds,
    errors,
  })
}
