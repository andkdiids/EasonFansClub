import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit, createPostModerationHistory } from '@/lib/admin-audit'
import { awardFeaturedPostRewards } from '@/lib/community-rewards'
import { getCurrentUser, type SessionUser } from '@/lib/auth'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { hasTooManyContentImages, MAX_CONTENT_IMAGES, publicContentImageMarkers } from '@/lib/content-images'
import { isSupabaseStorageUrl, publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtimeToAdmins } from '@/lib/realtime'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { requireUser, sanitizeText } from '@/lib/security'
import { checkPostForbiddenWords, formatPostForbiddenWordFieldErrors, formatPostForbiddenWordMessage, CONTENT_CONTAINS_BANNED_WORD, publicModerationText } from '@/lib/content-moderation'
import { createManyNotifications } from '@/lib/notification-write'
import {
  logPostRichContentCompatibilityMode,
  resolvePostContentInput,
} from '@/lib/post-rich-content-compat'

type Params = { params: Promise<{ postId: string }> }

const POST_DETAIL_REPLY_LIMIT = 50

// Keep this query explicit while production is waiting for the rich-content
// migration. A top-level include would select every Post scalar, including
// Post.richContent, even though the detail API only needs the legacy content.
const postDetailSelect = {
  id: true,
  title: true,
  content: true,
  ipRegion: true,
  viewCount: true,
  likeCount: true,
  replyCount: true,
  isPinned: true,
  profilePinnedAt: true,
  isFeatured: true,
  isDeleted: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  authorId: true,
  boardId: true,
  contentType: true,
  favoriteCount: true,
  isLocked: true,
  isRecommended: true,
  publishedAt: true,
  readUserCount: true,
  shareCount: true,
  status: true,
  moderationStatus: true,
  moderationReason: true,
  matchedBannedWords: true,
  reviewedAt: true,
  reviewedById: true,
  rejectionReason: true,
  summary: true,
  stickerId: true,
  User: {
    select: {
      id: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      level: true,
      avatarUrl: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
    },
  },
  Board: { select: { name: true, slug: true } },
  Reply: {
    where: {
      isDeleted: false,
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    },
    orderBy: { createdAt: 'asc' as const },
    take: POST_DETAIL_REPLY_LIMIT,
    select: {
      id: true,
      content: true,
      ipRegion: true,
      stickerId: true,
      isDeleted: true,
      moderationStatus: true,
      moderationReason: true,
      matchedBannedWords: true,
      isPinned: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      postId: true,
      authorId: true,
      parentId: true,
      likeCount: true,
      User: {
        select: {
          id: true,
          nickname: true,
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          level: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
    },
  },
  PostMedia: {
    where: { type: 'IMAGE' as const },
    orderBy: { sortOrder: 'asc' as const },
    select: { id: true, url: true, thumbnail: true, width: true, height: true, sortOrder: true },
  },
} satisfies Prisma.PostSelect

function redactPostDeleteErrorText(value: string) {
  return value
    .replace(/\b(?:mysql|mariadb|postgres(?:ql)?|prisma(?:\+postgres)?):\/\/[^\s'\"]+/gi, (match) => `${match.slice(0, match.indexOf('://') + 3)}[redacted]`)
    .replace(/\b(password|passwd|secret|token|cookie|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
}

function safePostDeleteErrorMeta(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, item]) => {
    if (/authorization|cookie|database|password|secret|token|url/i.test(key)) return [key, '[redacted]']
    if (typeof item === 'string') return [key, redactPostDeleteErrorText(item).slice(0, 500)]
    return [key, item]
  }))
}

function describePostDeleteError(error: unknown) {
  const knownError = error instanceof Prisma.PrismaClientKnownRequestError
  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorCode: knownError ? error.code : undefined,
    meta: knownError ? safePostDeleteErrorMeta(error.meta) : undefined,
    message: redactPostDeleteErrorText(error instanceof Error ? error.message : String(error)),
  }
}

function postDeleteErrorResponse(error: unknown, postId: string, userId: string) {
  const errorMessage = error instanceof Error ? error.message : ''
  const errorCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined
  console.error('[posts.delete]', { postId, userId, ...describePostDeleteError(error) })

  if (errorMessage === 'POST_DELETE_FORBIDDEN') {
    return NextResponse.json({ message: '你只能删除自己发布的帖子' }, { status: 403 })
  }
  if (errorMessage === 'POST_NOT_FOUND' || errorMessage === 'POST_ALREADY_DELETED' || errorCode === 'P2025') {
    return NextResponse.json({ message: '帖子不存在或已经被删除' }, { status: 404 })
  }
  return NextResponse.json({ message: '删除帖子失败，请稍后重试' }, { status: 500 })
}

function describePostEditError(error: unknown) {
  const knownError = error instanceof Prisma.PrismaClientKnownRequestError
  const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : undefined
  const stack = error instanceof Error ? error.stack : undefined
  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorCode: typeof errorRecord?.code === 'string' ? errorRecord.code : undefined,
    prismaCode: knownError ? error.code : undefined,
    meta: knownError ? safePostDeleteErrorMeta(error.meta) : undefined,
    message: redactPostDeleteErrorText(error instanceof Error ? error.message : String(error)),
    stack: stack ? redactPostDeleteErrorText(stack).slice(0, 4000) : undefined,
  }
}

type PostMutationOperation = 'edit' | 'feature' | 'pin' | 'delete' | 'manage'

function getPostMutationOperation(phase: string): PostMutationOperation {
  if (phase.startsWith('feature')) return 'feature'
  if (phase.startsWith('pin')) return 'pin'
  if (phase.startsWith('delete')) return 'delete'
  if (phase.startsWith('edit')) return 'edit'
  return 'manage'
}

function logPostEditError(error: unknown, postId: string, userId: string, phase: string) {
  console.error('[posts.update]', {
    operation: getPostMutationOperation(phase),
    postId,
    userId,
    phase,
    ...describePostEditError(error),
  })
}

function postEditErrorResponse(error: unknown, postId: string, userId: string, phase: string) {
  logPostEditError(error, postId, userId, phase)
  const operation = getPostMutationOperation(phase)
  const isFeatureOperation = operation === 'feature'
  const errorMessage = error instanceof Error ? error.message : ''
  const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : undefined
  const errorCode = typeof errorRecord?.code === 'string' ? errorRecord.code : undefined
  const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : errorCode

  if (errorMessage === 'POST_NOT_FOUND' || errorMessage === 'POST_ALREADY_DELETED' || prismaCode === 'P2025') {
    return NextResponse.json({ ok: false, code: 'POST_NOT_FOUND', message: '帖子不存在或已经被删除' }, { status: 404 })
  }
  if (prismaCode === 'P2003') {
    return NextResponse.json({ ok: false, code: isFeatureOperation ? 'POST_FEATURE_REFERENCE_INVALID' : 'POST_EDIT_REFERENCE_INVALID', message: isFeatureOperation ? '设置精华所需的帖子或作者关联已失效，请刷新后重试' : '帖子关联的板块或用户已失效，请刷新后重试' }, { status: 409 })
  }
  if (prismaCode === 'P2002') {
    return NextResponse.json({ ok: false, code: isFeatureOperation ? 'POST_FEATURE_CONFLICT' : 'POST_EDIT_CONFLICT', message: isFeatureOperation ? '设置精华发生重复提交，请刷新后重试' : '保存发生冲突，请刷新后重试' }, { status: 409 })
  }
  if (prismaCode === 'P2021' || prismaCode === 'P2022') {
    return NextResponse.json({ ok: false, code: isFeatureOperation ? 'POST_FEATURE_SCHEMA_UNAVAILABLE' : 'POST_EDIT_SCHEMA_UNAVAILABLE', message: '帖子服务暂时不可用，请联系管理员' }, { status: 503 })
  }
  if (prismaCode === 'P1001' || prismaCode === 'P1002' || prismaCode === 'P1008' || prismaCode === 'P1017' || prismaCode === 'P2024' || prismaCode === 'P2028') {
    return NextResponse.json({ ok: false, code: isFeatureOperation ? 'POST_FEATURE_DATABASE_UNAVAILABLE' : 'POST_EDIT_DATABASE_UNAVAILABLE', message: '帖子服务暂时不可用，请联系管理员' }, { status: 503 })
  }
  if (prismaCode === 'P2034') {
    return NextResponse.json({ ok: false, code: isFeatureOperation ? 'POST_FEATURE_CONFLICT' : 'POST_EDIT_CONFLICT', message: isFeatureOperation ? '设置精华发生并发冲突，请刷新后重试' : '保存发生并发冲突，请刷新后重试' }, { status: 409 })
  }
  return NextResponse.json({ ok: false, code: isFeatureOperation ? 'POST_FEATURE_FAILED' : 'POST_EDIT_FAILED', message: isFeatureOperation ? '设置精华失败，请稍后重试' : '保存失败，请稍后重试' }, { status: 500 })
}

async function executePostDelete(postId: string, user: SessionUser, canManagePosts: boolean) {
  const existing = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, isDeleted: true },
  })
  if (!existing || existing.isDeleted) throw new Error(existing ? 'POST_ALREADY_DELETED' : 'POST_NOT_FOUND')
  if (existing.authorId !== user.id && !canManagePosts) throw new Error('POST_DELETE_FORBIDDEN')

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const lockedExisting = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        boardId: true,
        isDeleted: true,
        title: true,
        User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
      },
    })
    if (!lockedExisting) throw new Error('POST_NOT_FOUND')
    if (lockedExisting.isDeleted) throw new Error('POST_ALREADY_DELETED')
    if (lockedExisting.authorId !== user.id && !canManagePosts) throw new Error('POST_DELETE_FORBIDDEN')

    const post = await tx.post.update({
      where: { id: postId },
      data: { isDeleted: true, deletedAt: new Date(), profilePinnedAt: null },
      select: { id: true, isDeleted: true, deletedAt: true },
    })
    const postCount = await tx.post.count({
      where: { boardId: lockedExisting.boardId, status: 'PUBLISHED', isDeleted: false },
    })
    await tx.board.update({ where: { id: lockedExisting.boardId }, data: { postCount } })

    return {
      post,
      audit: {
        operatorId: user.id,
        action: 'DELETE_POST' as const,
        operationType: adminAuditOperations.POST_DELETED,
        targetType: 'POST',
        targetId: postId,
        targetTitle: lockedExisting.title,
        targetUserId: lockedExisting.authorId,
        targetUserName: lockedExisting.User.nickname || 'E院用户',
        targetUserUid: lockedExisting.User.uid,
        metadata: { isDeleted: true },
      },
    }
  })
}

async function postDeleteResponse(postId: string, user: SessionUser, canManagePosts: boolean) {
  try {
    const result = await executePostDelete(postId, user, canManagePosts)

    if (canManagePosts) {
      try {
        // Audit is valuable, but a drifted/partially migrated audit table must
        // not roll back the already committed content deletion.
        await prisma.$transaction((tx) => createAdminActionAudit(tx, result.audit))
      } catch (error) {
        console.error('[posts.delete.audit]', { postId, userId: user.id, ...describePostDeleteError(error) })
      }
    }

    try {
      revalidatePath('/forum')
      revalidatePath('/community')
      revalidatePath('/trending')
      revalidatePath('/rankings')
      revalidatePath('/search')
      revalidatePath('/profile')
      revalidatePath('/user/[uid]', 'page')
      revalidatePath(`/posts/${postId}`)
      revalidateTag('trending-posts')
    } catch (error) {
      console.error('[posts.delete.cache]', { postId, userId: user.id, ...describePostDeleteError(error) })
    }

    return NextResponse.json({ ok: true, post: result.post, message: '帖子已删除' })
  } catch (error) {
    return postDeleteErrorResponse(error, postId, user.id)
  }
}

function stripUnsafeHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function createSummary(content: string, length = 180) {
  return content.length > length ? `${content.slice(0, length)}...` : content
}

/** 校验单个图片 URL 是否为可接受的存储地址（仅允许腾讯云 COS，禁止 Supabase 等旧地址）。 */
function isAcceptableImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const url = value.trim()
  if (!url) return false
  if (isSupabaseStorageUrl(url)) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

export async function GET(_request: Request, { params }: Params) {
  const viewer = await getCurrentUser()
  const { postId } = await params
  const viewerCanManagePosts = Boolean(viewer && await hasAdminPermission(viewer, 'post_manage'))
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      isDeleted: false,
      status: 'PUBLISHED',
       ...(viewerCanManagePosts ? {} : {
        OR: [
          { moderationStatus: { in: ['APPROVED', 'VIOLATION'] as const } },
          ...(viewer ? [{ authorId: viewer.id }] : []),
        ],
      }),
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    },
    select: postDetailSelect,
  })

  if (!post) {
    return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  }

  const { User, Board, Reply, PostMedia, ...postData } = post
  const author = User.Profile ? {
    ...User,
    nickname: getPublicUserDisplayName(User),
    avatarUrl: publicImageUrl(User.avatarUrl),
    Profile: {
      ...User.Profile,
      avatarUrl: publicImageUrl(User.Profile.avatarUrl),
      displayName: getPublicUserDisplayName(User),
    },
  } : { ...User, nickname: getPublicUserDisplayName(User), avatarUrl: publicImageUrl(User.avatarUrl) }
  return NextResponse.json({
    post: {
      ...postData,
      title: publicModerationText(postData.title, postData.moderationStatus),
      content: publicModerationText(publicContentImageMarkers(postData.content), postData.moderationStatus),
      richContent: null,
      author,
      board: Board,
      media: PostMedia.map((media) => ({
        ...media,
        url: publicImageUrl(media.url) || media.url,
        thumbnail: publicImageUrl(media.thumbnail),
      })),
      replies: Reply.map(({ User: replyAuthor, ...reply }) => ({
        ...reply,
        content: publicModerationText(publicContentImageMarkers(reply.content), reply.moderationStatus),
        author: replyAuthor.Profile ? {
          ...replyAuthor,
          nickname: getPublicUserDisplayName(replyAuthor),
          avatarUrl: publicImageUrl(replyAuthor.avatarUrl),
          Profile: {
            ...replyAuthor.Profile,
            avatarUrl: publicImageUrl(replyAuthor.Profile.avatarUrl),
            displayName: getPublicUserDisplayName(replyAuthor),
          },
        } : { ...replyAuthor, nickname: getPublicUserDisplayName(replyAuthor), avatarUrl: publicImageUrl(replyAuthor.avatarUrl) },
      })),
    },
  }, { headers: viewer ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { Vary: 'Cookie' } })
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { postId } = await params
  try {
    const canManagePosts = await hasAdminPermission(guard.user, 'post_manage')
    return postDeleteResponse(postId, guard.user, canManagePosts)
  } catch (error) {
    return postDeleteErrorResponse(error, postId, guard.user.id)
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  let postId = 'unknown'
  let phase = 'params'

  try {
    ({ postId } = await params)
    phase = 'parse-body'
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ message: '请求参数无效' }, { status: 400 })
    }

    const requestKind: 'feature' | 'pin' | 'manage' = typeof body.isFeatured === 'boolean'
      ? 'feature'
      : typeof body.isPinned === 'boolean'
        ? 'pin'
        : 'manage'
    phase = `${requestKind}-load-post`
    const existing = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        boardId: true,
        isDeleted: true,
        status: true,
        isFeatured: true,
        title: true,
        content: true,
        stickerId: true,
        moderationStatus: true,
      },
    })
    if (!existing) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
    if (existing.isDeleted) return NextResponse.json({ message: '帖子已删除，无法继续操作' }, { status: 404 })

    phase = `${requestKind}-load-permissions`
    const canManagePosts = await hasAdminPermission(guard.user, 'post_manage')
    const isOwner = existing.authorId === guard.user.id

    // 编辑意图：请求体带有标题 / 正文 / 媒体（保留或新增）字段。
    const wantsEdit =
      typeof body.title === 'string' ||
      typeof body.content === 'string' ||
      Object.prototype.hasOwnProperty.call(body, 'richContent') ||
      typeof body.boardId === 'string' ||
      Array.isArray(body.keepMediaIds) ||
      Array.isArray(body.addImageUrls)
    if (wantsEdit) {
      phase = 'edit'
      return await handleEditPost(request, {
        postId,
        existing,
        user: guard.user,
        canManagePosts,
        isOwner,
        body,
        setPhase: (nextPhase) => { phase = nextPhase },
      })
    }

    // 其余情况沿用原有管理/删除逻辑（置顶、精选、删除/恢复）。
    const data: { isPinned?: boolean; isFeatured?: boolean; isDeleted?: boolean; deletedAt?: Date | null } = {}
    if (typeof body?.isPinned === 'boolean') data.isPinned = body.isPinned
    if (typeof body?.isFeatured === 'boolean') data.isFeatured = body.isFeatured
    if (typeof body?.isDeleted === 'boolean') {
      data.isDeleted = body.isDeleted
      data.deletedAt = body.isDeleted ? new Date() : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: '没有可更新的字段' }, { status: 400 })
    }

    // Keep the legacy PATCH contract for older clients, but route every delete
    // request through the explicit Post delete flow. Deletion is terminal and
    // must not share a transaction with pin/feature side effects.
    if (data.isDeleted === true) {
      phase = 'delete'
      return await postDeleteResponse(postId, guard.user, canManagePosts)
    }

    const changesModeration = data.isPinned !== undefined || data.isFeatured !== undefined
    if (changesModeration && !canManagePosts) {
      return NextResponse.json({ message: '只有管理员可以置顶或精选帖子' }, { status: 403 })
    }
    if (data.isDeleted !== undefined) {
      if (data.isDeleted && !isOwner && !canManagePosts) {
        return NextResponse.json({ message: '只能删除自己发布的帖子' }, { status: 403 })
      }
      if (!data.isDeleted && !canManagePosts) {
        return NextResponse.json({ message: '只有管理员可以恢复帖子' }, { status: 403 })
      }
    }

    const mutationKind: 'feature' | 'pin' | 'manage' = data.isFeatured !== undefined
      ? 'feature'
      : data.isPinned !== undefined
        ? 'pin'
        : 'manage'
    phase = `${mutationKind}-lock`
    const post = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
      phase = `${mutationKind}-load`
    const lockedExisting = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        boardId: true,
        isDeleted: true,
        isPinned: true,
        isFeatured: true,
        title: true,
        User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
      },
    })
    if (!lockedExisting) throw new Error('POST_NOT_FOUND')

    phase = `${mutationKind}-update`
    const updated = await tx.post.update({
      where: { id: postId },
      data,
      select: { id: true, isPinned: true, isFeatured: true, isDeleted: true },
    })

    if (data.isDeleted !== undefined && lockedExisting.isDeleted !== data.isDeleted) {
      const postCount = await tx.post.count({
        where: { boardId: lockedExisting.boardId, status: 'PUBLISHED', isDeleted: false },
      })
      await tx.board.update({
        where: { id: lockedExisting.boardId },
        data: { postCount },
      })
    }

    if (data.isFeatured === true && !lockedExisting.isFeatured) {
      phase = 'feature-reward'
      await awardFeaturedPostRewards(tx, {
        postId,
        authorId: lockedExisting.authorId,
      })
    }

    const changedPinned = data.isPinned !== undefined && lockedExisting.isPinned !== data.isPinned
    const changedFeatured = data.isFeatured !== undefined && lockedExisting.isFeatured !== data.isFeatured
    const changedDeleted = data.isDeleted !== undefined && lockedExisting.isDeleted !== data.isDeleted
    const auditTarget = {
      operatorId: guard.user.id,
      targetType: 'POST' as const,
      targetId: postId,
      targetTitle: lockedExisting.title,
      targetUserId: lockedExisting.authorId,
      targetUserName: lockedExisting.User.nickname || 'E院用户',
      targetUserUid: lockedExisting.User.uid,
      metadata: {
        isPinned: data.isPinned ?? null,
        isFeatured: data.isFeatured ?? null,
        isDeleted: data.isDeleted ?? null,
      },
    }
    if (canManagePosts && changedDeleted) {
      phase = 'manage-audit'
      try {
        await createAdminActionAudit(tx, {
          ...auditTarget,
          action: data.isDeleted ? 'DELETE_POST' : 'RESTORE_POST',
          operationType: data.isDeleted ? adminAuditOperations.POST_DELETED : adminAuditOperations.POST_RESTORED,
        })
      } catch (error) {
        // Audit history is diagnostic/append-only data. It must not roll back
        // a successful post state change or its account-consistent reward.
        logPostEditError(error, postId, guard.user.id, 'manage-audit')
      }
    }
    if (canManagePosts && changedPinned) {
      phase = 'pin-audit'
      try {
        await createAdminActionAudit(tx, {
          ...auditTarget,
          action: data.isPinned ? 'PIN_POST' : 'UNPIN_POST',
          operationType: data.isPinned ? adminAuditOperations.POST_PINNED : adminAuditOperations.POST_UNPINNED,
        })
      } catch (error) {
        logPostEditError(error, postId, guard.user.id, 'pin-audit')
      }
    }
    if (canManagePosts && changedFeatured) {
      phase = 'feature-audit'
      try {
        await createAdminActionAudit(tx, {
          ...auditTarget,
          action: data.isFeatured ? 'FEATURE_POST' : 'UNFEATURE_POST',
          operationType: data.isFeatured ? adminAuditOperations.POST_FEATURED : adminAuditOperations.POST_UNFEATURED,
        })
      } catch (error) {
        logPostEditError(error, postId, guard.user.id, 'feature-audit')
      }
    }

    return updated
    })

    if (data.isFeatured === true && !existing.isFeatured) triggerBadgeEvaluation(existing.authorId, 'POST_FEATURED')

    phase = `${mutationKind}-cache`
    revalidatePath('/forum')
    revalidatePath('/community')
    revalidatePath('/trending')
    revalidatePath('/rankings')
    revalidatePath('/search')
    revalidatePath(`/posts/${postId}`)
    revalidateTag('trending-posts')

    return NextResponse.json({ post })
  } catch (error) {
    return postEditErrorResponse(error, postId, guard.user.id, phase)
  }
}

type EditContext = {
  postId: string
  existing: {
    id: string
    authorId: string
    boardId: string
    status: string
    title: string
    content: string
    stickerId: string | null
    moderationStatus: string
  }
  user: Pick<SessionUser, 'id' | 'role'>
  canManagePosts: boolean
  isOwner: boolean
  body: Record<string, unknown>
  setPhase: (phase: string) => void
}

async function handleEditPost(
  request: Request,
  ctx: EditContext,
) {
  const { postId, existing, user, canManagePosts, isOwner, body, setPhase } = ctx

  setPhase('edit-authorize')
  if (!isOwner && !canManagePosts) {
    return NextResponse.json({ message: '只能编辑自己发布的帖子' }, { status: 403 })
  }

  const rawTitle = sanitizeText(typeof body.title === 'string' ? body.title : existing.title, 120)
  const hasRichContentField = Object.prototype.hasOwnProperty.call(body, 'richContent')
  const contentInput = resolvePostContentInput({
    content: typeof body.content === 'string' ? body.content : existing.content,
    richContent: body.richContent,
    hasRichContent: hasRichContentField,
  })
  if (contentInput.validation && !contentInput.validation.valid) {
      return NextResponse.json({
        message: '正文格式无效，请刷新后重试',
        errors: { content: '正文格式无效' },
        details: contentInput.validation.errors,
      }, { status: 400 })
  }
  if (contentInput.usedCompatibilityMode && contentInput.validation?.valid) {
    logPostRichContentCompatibilityMode('edit', postId)
  }
  const rawContent = stripUnsafeHtml(sanitizeText(contentInput.content, 20000))
  const hasSticker = Boolean(existing.stickerId)
  const nextBoardId = typeof body.boardId === 'string' ? sanitizeText(body.boardId, 80) : existing.boardId

  setPhase('edit-board')
  const board = await prisma.board.findFirst({
    where: { id: nextBoardId, isActive: true },
    select: { id: true, slug: true },
  })
  if (!board) return NextResponse.json({ message: '板块不存在或已停用', errors: { boardId: '板块无效' } }, { status: 404 })
  if (board.slug === 'announcements' && !canManagePosts) {
    return NextResponse.json({ message: '只有内容管理员可以编辑公告区帖子', errors: { boardId: '无权编辑公告区' } }, { status: 403 })
  }

  setPhase('edit-moderation')
  const forbiddenWords = await checkPostForbiddenWords({ title: rawTitle, content: rawContent }, user)
  if (forbiddenWords.blocked) {
    return NextResponse.json({
      error: CONTENT_CONTAINS_BANNED_WORD,
      message: formatPostForbiddenWordMessage(forbiddenWords.matches, forbiddenWords.hasMore),
      matches: forbiddenWords.matches,
      hasMore: forbiddenWords.hasMore,
      errors: formatPostForbiddenWordFieldErrors(forbiddenWords.matches),
    }, { status: 400 })
  }

  const errors: Record<string, string> = {}
  if (rawTitle.length < 3) errors.title = '标题至少需要 3 个字符'
  if (!hasSticker && rawContent.trim().length < 5) errors.content = '正文至少需要 5 个字符'

  // 解析并校验媒体变更。
  const keepMediaIds = Array.isArray(body.keepMediaIds)
    ? body.keepMediaIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null
  const addImageUrls = Array.isArray(body.addImageUrls)
    ? body.addImageUrls.filter(isAcceptableImageUrl)
    : []

  // 统计当前帖子已保留的图片数量，确保总量不超过上限。
  setPhase('edit-media-read')
  const currentMedia = await prisma.postMedia.findMany({
    where: { postId, type: 'IMAGE' },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  })

  const keptIds = keepMediaIds
    ? keepMediaIds.filter((id) => currentMedia.some((media) => media.id === id))
    : currentMedia.map((media) => media.id)
  const currentMediaIds = currentMedia.map((media) => media.id)
  const mediaChanged = addImageUrls.length > 0
    || keptIds.length !== currentMediaIds.length
    || keptIds.some((id, index) => id !== currentMediaIds[index])
  const contentChanged = rawTitle !== existing.title || rawContent !== existing.content || nextBoardId !== existing.boardId || mediaChanged
  const removedCount = currentMedia.length - keptIds.length
  const keptCount = keptIds.length
  if (hasTooManyContentImages(body.addImageUrls) || keptCount + addImageUrls.length > MAX_CONTENT_IMAGES) {
    errors.media = `图片数量不能超过 ${MAX_CONTENT_IMAGES} 张`
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ message: '请检查帖子内容', errors }, { status: 400 })
  }
  if (!contentChanged) {
    return NextResponse.json({
      post: {
        id: existing.id,
        title: existing.title,
        content: publicContentImageMarkers(existing.content),
        richContent: null,
        moderationStatus: existing.moderationStatus,
      },
      moderationStatus: existing.moderationStatus,
      message: '没有检测到内容变化',
    })
  }

  setPhase('edit-transaction')
  const transactionResult = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const lockedExisting = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        boardId: true,
        title: true,
        moderationStatus: true,
        rejectionReason: true,
        User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
      },
    })
    if (!lockedExisting) throw new Error('POST_NOT_FOUND')

    const updatedPost = await tx.post.update({
      where: { id: postId },
      data: {
        title: rawTitle,
        content: rawContent,
        summary: createSummary(rawContent),
        boardId: nextBoardId,
        // 管理员编辑沿用现有直接发布豁免；普通用户编辑始终开启新的审核周期。
        ...(!canManagePosts ? {
          moderationStatus: 'PENDING' as const,
          moderationReason: null,
          matchedBannedWords: null,
          reviewedAt: null,
          reviewedById: null,
          rejectionReason: null,
        } : {}),
      },
      select: { id: true, title: true, content: true, moderationStatus: true, updatedAt: true },
    })

    // 删除被移除的图片（keepMediaIds 显式排除的）。
    if (removedCount > 0) {
      await tx.postMedia.deleteMany({
        where: { postId, type: 'IMAGE', id: { notIn: keptIds } },
      })
    }

    // 重新规整保留图片的排序，再追加新图片。
    const currentMediaById = new Map(currentMedia.map((media) => [media.id, media]))
    const keptMedia = keptIds.flatMap((id) => {
      const media = currentMediaById.get(id)
      return media ? [media] : []
    })
    for (let index = 0; index < keptMedia.length; index += 1) {
      await tx.postMedia.update({
        where: { id: keptMedia[index].id },
        data: { sortOrder: index },
      })
    }
    if (addImageUrls.length) {
      await tx.postMedia.createMany({
        data: addImageUrls.map((url, offset) => ({
          postId,
          type: 'IMAGE' as const,
          url,
          sortOrder: keptMedia.length + offset,
        })),
      })
    }

    if (!canManagePosts && lockedExisting.moderationStatus === 'APPROVED') {
      const affectedBoardIds = [...new Set([lockedExisting.boardId, nextBoardId])]
      for (const affectedBoardId of affectedBoardIds) {
        const postCount = await tx.post.count({
          where: { boardId: affectedBoardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
        })
        await tx.board.update({ where: { id: affectedBoardId }, data: { postCount } })
      }
    }
    if (canManagePosts && lockedExisting.boardId !== nextBoardId && lockedExisting.moderationStatus === 'APPROVED') {
      for (const affectedBoardId of [lockedExisting.boardId, nextBoardId]) {
        const postCount = await tx.post.count({
          where: { boardId: affectedBoardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
        })
        await tx.board.update({ where: { id: affectedBoardId }, data: { postCount } })
      }
    }

    return {
      post: updatedPost,
      previousModerationStatus: lockedExisting.moderationStatus,
      previousRejectionReason: lockedExisting.rejectionReason,
      audit: {
        operatorId: user.id,
        action: 'EDIT_POST' as const,
        operationType: adminAuditOperations.POST_EDITED,
        targetType: 'POST',
        targetId: postId,
        targetTitle: rawTitle,
        targetUserId: lockedExisting.authorId,
      targetUserName: lockedExisting.User.nickname || 'E院用户',
        targetUserUid: lockedExisting.User.uid,
        metadata: { changedFields: ['title', 'content', 'boardId', ...(mediaChanged ? ['media'] : [])] },
      },
    }
  })

  const reviewNotificationKey = canManagePosts ? null : `post-review:${postId}:${randomUUID()}`
  if (!canManagePosts) {
    setPhase('edit-moderation-history')
    try {
      await createPostModerationHistory(prisma, {
        postId,
        actorId: user.id,
        action: 'EDITED',
        status: 'PENDING',
        titleSnapshot: rawTitle,
        rejectionReason: transactionResult.previousModerationStatus === 'REJECTED' ? transactionResult.previousRejectionReason : null,
      })
    } catch (error) {
      logPostEditError(error, postId, user.id, 'edit-moderation-history')
    }

    setPhase('edit-activity-cleanup')
    try {
      // The old approval activity must not keep linking ordinary users to a
      // post that is now waiting for its edited content to be reviewed.
      await prisma.friendActivity.deleteMany({
        where: { type: 'POST', targetUrl: `/posts/${postId}` },
      })
    } catch (error) {
      logPostEditError(error, postId, user.id, 'edit-activity-cleanup')
    }

    setPhase('edit-review-notification')
    try {
      const admins = await prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
        select: { id: true },
      })
      if (admins.length && reviewNotificationKey) {
        await createManyNotifications({
          data: admins.map((admin) => ({
            recipientId: admin.id,
            type: 'ADMIN' as const,
            title: '帖子编辑后待审核',
            content: rawTitle,
            link: '/admin/posts/review',
            key: reviewNotificationKey,
          })),
          skipDuplicates: true,
        })
      }
    } catch (error) {
      logPostEditError(error, postId, user.id, 'edit-review-notification')
    }
  } else {
    setPhase('edit-admin-audit')
    try {
      await createAdminActionAudit(prisma, transactionResult.audit)
    } catch (error) {
      // Audit history is useful but must not roll back a successful content
      // update when production is still on the older AdminAction schema.
      logPostEditError(error, postId, user.id, 'edit-admin-audit')
    }
  }

  setPhase('edit-cache')
  try {
    revalidatePath('/community')
    revalidatePath('/forum')
    revalidatePath('/trending')
    revalidatePath('/rankings')
    revalidatePath('/search')
    revalidatePath('/admin/posts/review')
    revalidatePath('/user/[uid]', 'page')
    revalidatePath(`/posts/${postId}`)
    revalidateTag('trending-posts')
  } catch (error) {
    logPostEditError(error, postId, user.id, 'edit-cache')
  }
  if (!canManagePosts) {
    void emitRealtimeToAdmins('notification').catch((error) => {
      logPostEditError(error, postId, user.id, 'edit-realtime')
    })
  }

  return NextResponse.json({
    post: {
      id: transactionResult.post.id,
      title: transactionResult.post.title,
      content: publicContentImageMarkers(transactionResult.post.content),
      richContent: null,
      moderationStatus: transactionResult.post.moderationStatus,
      updatedAt: transactionResult.post.updatedAt,
    },
    moderationStatus: transactionResult.post.moderationStatus,
    message: canManagePosts ? '帖子已保存' : '修改已保存，正在等待审核，审核通过后会重新展示。',
  })
}
