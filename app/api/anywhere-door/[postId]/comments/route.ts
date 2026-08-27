import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { isAnywhereDoorEnabled } from '@/lib/anywhere-door/config'
import { createNotification } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'
import { checkBannedWords, BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD } from '@/lib/content-moderation'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { decodeSocialCommentCursor, getPublicSocialPostComments } from '@/lib/social-posts'

type RouteContext = { params: Promise<{ postId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  if (!(await canAccessAnywhereDoor(guard.user))) return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED', message: '随意门当前未开放' }, { status: 404 })
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/anywhere-door/[postId]/comments:POST',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  })
  if (limited) return limited
  const { postId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(postId)) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
  const body = await request.json().catch(() => null)
  const content = sanitizeText(body?.content, 500)
  const parentId = sanitizeText(body?.parentId, 191)
  if (!content) return NextResponse.json({ message: '评论内容不能为空' }, { status: 400 })
  if ((await checkBannedWords(content)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }

  let recipientId: string | null = null
  let notificationLink: string | null = null
  let notificationTitle = '有人回复了你的评论'
  try {
    const comment = await prisma.$transaction(async (tx) => {
      const post = await tx.socialPost.findFirst({ where: { id: postId, status: 'READY' }, select: { id: true } })
      if (!post) throw new Error('SOCIAL_POST_NOT_FOUND')
      let parent: { id: string; authorId: string; parentId: string | null } | null = null
      if (parentId) {
        parent = await tx.socialPostComment.findFirst({ where: { id: parentId, postId, deletedAt: null }, select: { id: true, authorId: true, parentId: true } })
        if (!parent) throw new Error('SOCIAL_COMMENT_NOT_FOUND')
        if (parent.parentId) throw new Error('SOCIAL_REPLY_NOT_ALLOWED')
        if (parent.authorId !== guard.user.id) recipientId = parent.authorId
      } else {
        notificationTitle = '你的随意门动态有新评论'
      }
      const created = await tx.socialPostComment.create({ data: { postId, authorId: guard.user.id, parentId: parent?.id || null, content } })
      notificationLink = `/anywhere-door/${postId}#comment-${created.id}`
      return created
    })

    if (recipientId && notificationLink) {
      const recipient = recipientId
      const link = notificationLink
      await safeNotificationWrite(
        () => createNotification({
          data: {
            recipientId: recipient,
            actorId: guard.user.id,
            type: 'REPLY',
            title: notificationTitle,
            content: `${guard.user.nickname} 回复了你的评论`,
            link,
            key: `social-comment:${comment.id}`,
          },
        }),
        { operation: 'social-post-comment-notification', userId: recipient, notificationType: 'REPLY' },
      )
      emitRealtime(recipient, 'notification')
    }
    return NextResponse.json({ comment: { id: comment.id, content: comment.content, createdAt: comment.createdAt.toISOString(), author: { id: guard.user.id, nickname: guard.user.nickname } } }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'SOCIAL_POST_NOT_FOUND') return NextResponse.json({ message: '动态不存在' }, { status: 404 })
    if (error instanceof Error && error.message === 'SOCIAL_COMMENT_NOT_FOUND') return NextResponse.json({ message: '不能回复不存在或已删除的评论' }, { status: 400 })
    if (error instanceof Error && error.message === 'SOCIAL_REPLY_NOT_ALLOWED') return NextResponse.json({ message: '回复只支持一级楼中楼' }, { status: 400 })
    console.error('[anywhere-door.comment]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '评论暂时无法提交' }, { status: 503 })
  }
}

export async function GET(request: Request, context: RouteContext) {
  const viewer = await getCurrentUser()
  if (!viewer && !isAnywhereDoorEnabled()) return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED', message: '随意门当前未开放' }, { status: 404 })
  if (viewer && !(await canAccessAnywhereDoor(viewer))) return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED', message: '随意门当前未开放' }, { status: 404 })
  const limited = await enforceApiRateLimit(request, viewer?.id, {
    endpoint: '/api/anywhere-door/[postId]/comments:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  const { postId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(postId)) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
  const url = new URL(request.url)
  const cursor = url.searchParams.get('cursor')
  const parentId = url.searchParams.get('parentId') || null
  if (cursor && !decodeSocialCommentCursor(cursor)) return NextResponse.json({ message: '评论分页游标无效' }, { status: 400 })
  if (parentId && !/^[a-zA-Z0-9_-]{1,191}$/.test(parentId)) return NextResponse.json({ message: '评论不存在' }, { status: 404 })
  try {
    const result = await getPublicSocialPostComments({
      postId,
      parentId,
      cursor,
      limit: url.searchParams.get('limit'),
      viewerId: viewer?.id,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
  } catch (error) {
    console.error('[anywhere-door.comments.list]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '评论暂时无法加载' }, { status: 503 })
  }
}
