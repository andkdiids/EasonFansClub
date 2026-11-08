import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import { HOME_FEATURED_POSTS_CACHE_TAG } from '@/lib/home-data'
import { isCancellableApprovedSchedule } from '@/lib/post-scheduling'

type Params = { params: Promise<{ postId: string }> }

export async function DELETE(request: Request, { params }: Params) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { postId } = await params
  const canManagePosts = await hasAdminPermission(guard.user, 'post_manage')

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
      const post = await tx.post.findFirst({
        where: { id: postId, isDeleted: false },
        select: { id: true, authorId: true, moderationStatus: true, publicationStatus: true, status: true },
      })
      if (!post) throw new Error('POST_NOT_FOUND')
      if (post.authorId !== guard.user.id && !canManagePosts) throw new Error('POST_CANCEL_FORBIDDEN')
      if (!isCancellableApprovedSchedule({ ...post, isDeleted: false })) throw new Error('POST_NOT_WAITING_FOR_SCHEDULE')

      const now = new Date()
      const updated = await tx.post.updateMany({
        where: {
          id: postId,
          isDeleted: false,
          status: 'DRAFT',
          moderationStatus: 'APPROVED',
          publicationStatus: 'SCHEDULED',
        },
        data: { publicationStatus: 'CANCELLED' },
      })
      if (updated.count !== 1) throw new Error('POST_NOT_WAITING_FOR_SCHEDULE')
      await tx.postPublicationEvent.updateMany({
        where: { postId, status: 'WAITING' },
        data: { status: 'CANCELLED', completedAt: now, lockedAt: null, lockToken: null },
      })
      return tx.post.findUniqueOrThrow({
        where: { id: postId },
        select: { id: true, moderationStatus: true, publicationStatus: true, scheduledPublishAt: true },
      })
    })

    revalidatePath('/admin/posts/review')
    revalidatePath('/profile')
    revalidatePath('/user/[uid]', 'page')
    revalidateTag(HOME_FEATURED_POSTS_CACHE_TAG)
    return NextResponse.json({ post: result, message: '定时发布已取消' })
  } catch (error) {
    const reason = error instanceof Error ? error.message : ''
    if (reason === 'POST_NOT_FOUND') return NextResponse.json({ message: '帖子不存在或已删除' }, { status: 404 })
    if (reason === 'POST_CANCEL_FORBIDDEN') return NextResponse.json({ message: '无权取消此帖子的定时发布' }, { status: 403 })
    if (reason === 'POST_NOT_WAITING_FOR_SCHEDULE') return NextResponse.json({ message: '帖子已公开、拒绝或不再等待定时发布' }, { status: 409 })
    console.error('[posts.schedule.cancel.failed]', { postId, userId: guard.user.id, error: reason || 'UNKNOWN' })
    return NextResponse.json({ message: '取消定时发布失败，请稍后重试' }, { status: 500 })
  }
}
