import { randomUUID } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit, createPostModerationHistory } from '@/lib/admin-audit'
import { awardFeaturedPostRewards } from '@/lib/community-rewards'
import { getCurrentUser, type SessionUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { hasTooManyContentImages, MAX_CONTENT_IMAGES, publicContentImageMarkers } from '@/lib/content-images'
import { isSupabaseStorageUrl, publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtimeToAdmins } from '@/lib/realtime'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { requireUser, sanitizeText } from '@/lib/security'
import { checkPostForbiddenWords, formatPostForbiddenWordFieldErrors, formatPostForbiddenWordMessage, CONTENT_CONTAINS_BANNED_WORD, publicModerationText, shouldBypassForbiddenWords } from '@/lib/content-moderation'

type Params = { params: Promise<{ postId: string }> }

const POST_DETAIL_REPLY_LIMIT = 50

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
    include: {
      User: {
        select: {
          id: true,
          nickname: true,
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
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
        orderBy: { createdAt: 'asc' },
        take: POST_DETAIL_REPLY_LIMIT,
        include: {
          User: {
            select: {
              id: true,
              nickname: true,
              usernameModerationStatus: true,
              nicknameModerationStatus: true,
              level: true,
              avatarUrl: true,
              Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
            },
          },
        },
      },
      PostMedia: {
        where: { type: 'IMAGE' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, url: true, thumbnail: true, width: true, height: true, sortOrder: true },
      },
    },
  })

  if (!post) {
    return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  }

  const { User, Board, Reply, PostMedia, ...postData } = post
  const remarkMap = await loadFriendRemarkMap(viewer?.id, [User.id, ...Reply.map((reply) => reply.User.id)])
  const author = User.Profile ? {
    ...User,
    nickname: getPublicUserDisplayName(User),
    avatarUrl: publicImageUrl(User.avatarUrl),
    Profile: {
      ...User.Profile,
      avatarUrl: publicImageUrl(User.Profile.avatarUrl),
      displayName: resolveFriendDisplayName({
        viewerId: viewer?.id,
        targetUserId: User.id,
        fallbackName: getPublicUserDisplayName(User),
        remarkMap,
      }),
    },
  } : { ...User, nickname: getPublicUserDisplayName(User), avatarUrl: publicImageUrl(User.avatarUrl) }
  return NextResponse.json({
    post: {
      ...postData,
      title: publicModerationText(postData.title, postData.moderationStatus),
      content: publicModerationText(publicContentImageMarkers(postData.content), postData.moderationStatus),
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
            displayName: resolveFriendDisplayName({
              viewerId: viewer?.id,
              targetUserId: replyAuthor.id,
              fallbackName: getPublicUserDisplayName(replyAuthor),
              remarkMap,
            }),
          },
        } : { ...replyAuthor, nickname: getPublicUserDisplayName(replyAuthor), avatarUrl: publicImageUrl(replyAuthor.avatarUrl) },
      })),
    },
  }, { headers: viewer ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { Vary: 'Cookie' } })
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { postId } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ message: '请求参数无效' }, { status: 400 })
  }

  const existing = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      authorId: true,
      boardId: true,
      isDeleted: true,
      status: true,
      title: true,
      content: true,
      stickerId: true,
      moderationStatus: true,
    },
  })
  if (!existing) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  if (existing.isDeleted) return NextResponse.json({ message: '帖子已删除，无法继续操作' }, { status: 404 })

  const isAdmin = shouldBypassForbiddenWords(guard.user)
  const canManagePosts = await hasAdminPermission(guard.user, 'post_manage')
  const isOwner = existing.authorId === guard.user.id

  // 编辑意图：请求体带有标题 / 正文 / 媒体（保留或新增）字段。
  const wantsEdit =
    typeof body.title === 'string' ||
    typeof body.content === 'string' ||
    typeof body.boardId === 'string' ||
    Array.isArray(body.keepMediaIds) ||
    Array.isArray(body.addImageUrls)
  if (wantsEdit) return handleEditPost(request, { postId, existing, user: guard.user, isAdmin, canManagePosts, isOwner, body })

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

  const post = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
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
      targetUserName: lockedExisting.User.Profile?.displayName || lockedExisting.User.nickname,
      targetUserUid: lockedExisting.User.uid,
      metadata: {
        isPinned: data.isPinned ?? null,
        isFeatured: data.isFeatured ?? null,
        isDeleted: data.isDeleted ?? null,
      },
    }
    if (canManagePosts && changedDeleted) {
      await createAdminActionAudit(tx, {
        ...auditTarget,
        action: data.isDeleted ? 'DELETE_POST' : 'RESTORE_POST',
        operationType: data.isDeleted ? adminAuditOperations.POST_DELETED : adminAuditOperations.POST_RESTORED,
      })
    }
    if (canManagePosts && changedPinned) {
      await createAdminActionAudit(tx, {
        ...auditTarget,
        action: data.isPinned ? 'PIN_POST' : 'UNPIN_POST',
        operationType: data.isPinned ? adminAuditOperations.POST_PINNED : adminAuditOperations.POST_UNPINNED,
      })
    }
    if (canManagePosts && changedFeatured) {
      await createAdminActionAudit(tx, {
        ...auditTarget,
        action: data.isFeatured ? 'FEATURE_POST' : 'UNFEATURE_POST',
        operationType: data.isFeatured ? adminAuditOperations.POST_FEATURED : adminAuditOperations.POST_UNFEATURED,
      })
    }

    return updated
  })

  revalidatePath('/forum')
  revalidatePath('/community')
  revalidatePath('/trending')
  revalidatePath('/rankings')
  revalidatePath('/search')
  revalidatePath(`/posts/${postId}`)
  revalidateTag('trending-posts')

  return NextResponse.json({ post })
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
  isAdmin: boolean
  canManagePosts: boolean
  isOwner: boolean
  body: Record<string, unknown>
}

async function handleEditPost(
  request: Request,
  ctx: EditContext,
) {
  const { postId, existing, user, isAdmin, canManagePosts, isOwner, body } = ctx

  if (!isOwner && !canManagePosts) {
    return NextResponse.json({ message: '只能编辑自己发布的帖子' }, { status: 403 })
  }

  const rawTitle = sanitizeText(typeof body.title === 'string' ? body.title : existing.title, 120)
  const rawContent = stripUnsafeHtml(sanitizeText(typeof body.content === 'string' ? body.content : existing.content, 20000))
  const hasSticker = Boolean(existing.stickerId)
  const nextBoardId = typeof body.boardId === 'string' ? sanitizeText(body.boardId, 80) : existing.boardId

  const board = await prisma.board.findFirst({
    where: { id: nextBoardId, isActive: true },
    select: { id: true, slug: true },
  })
  if (!board) return NextResponse.json({ message: '板块不存在或已停用', errors: { boardId: '板块无效' } }, { status: 404 })
  if (board.slug === 'announcements' && !canManagePosts) {
    return NextResponse.json({ message: '只有内容管理员可以编辑公告区帖子', errors: { boardId: '无权编辑公告区' } }, { status: 403 })
  }

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
  if (!hasSticker && rawContent.length < 5) errors.content = '正文至少需要 5 个字符'

  // 解析并校验媒体变更。
  const keepMediaIds = Array.isArray(body.keepMediaIds)
    ? body.keepMediaIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null
  const addImageUrls = Array.isArray(body.addImageUrls)
    ? body.addImageUrls.filter(isAcceptableImageUrl)
    : []

  // 统计当前帖子已保留的图片数量，确保总量不超过上限。
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
      post: { id: existing.id, title: existing.title, content: publicContentImageMarkers(existing.content), moderationStatus: existing.moderationStatus },
      moderationStatus: existing.moderationStatus,
      message: '没有检测到内容变化',
    })
  }

  const reviewNotificationKey = isAdmin ? null : `post-review:${postId}:${randomUUID()}`
  const updated = await prisma.$transaction(async (tx) => {
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
        ...(!isAdmin ? {
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

    if (!isAdmin) {
      await createPostModerationHistory(tx, {
        postId,
        actorId: user.id,
        action: 'EDITED',
        status: 'PENDING',
        titleSnapshot: rawTitle,
        rejectionReason: lockedExisting.moderationStatus === 'REJECTED' ? lockedExisting.rejectionReason : null,
      })
      // The old approval activity must not keep linking ordinary users to a
      // post that is now waiting for its edited content to be reviewed.
      await tx.friendActivity.deleteMany({
        where: { type: 'POST', targetUrl: `/posts/${postId}` },
      })

      if (lockedExisting.moderationStatus === 'APPROVED') {
        const affectedBoardIds = [...new Set([lockedExisting.boardId, nextBoardId])]
        for (const affectedBoardId of affectedBoardIds) {
          const postCount = await tx.post.count({
            where: { boardId: affectedBoardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
          })
          await tx.board.update({ where: { id: affectedBoardId }, data: { postCount } })
        }
      }

      const admins = await tx.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
        select: { id: true },
      })
      if (admins.length && reviewNotificationKey) {
        await tx.notification.createMany({
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
    } else {
      await createAdminActionAudit(tx, {
        operatorId: user.id,
        action: 'EDIT_POST',
        operationType: adminAuditOperations.POST_EDITED,
        targetType: 'POST',
        targetId: postId,
        targetTitle: rawTitle,
        targetUserId: lockedExisting.authorId,
        targetUserName: lockedExisting.User.Profile?.displayName || lockedExisting.User.nickname,
        targetUserUid: lockedExisting.User.uid,
        metadata: { changedFields: ['title', 'content', 'boardId', ...(mediaChanged ? ['media'] : [])] },
      })
      if (lockedExisting.boardId !== nextBoardId && lockedExisting.moderationStatus === 'APPROVED') {
        for (const affectedBoardId of [lockedExisting.boardId, nextBoardId]) {
          const postCount = await tx.post.count({
            where: { boardId: affectedBoardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
          })
          await tx.board.update({ where: { id: affectedBoardId }, data: { postCount } })
        }
      }
    }

    return updatedPost
  })

  revalidatePath('/community')
  revalidatePath('/forum')
  revalidatePath('/trending')
  revalidatePath('/rankings')
  revalidatePath('/search')
  revalidatePath('/admin/posts/review')
  revalidatePath('/user/[uid]', 'page')
  revalidatePath(`/posts/${postId}`)
  revalidateTag('trending-posts')
  if (!isAdmin) void emitRealtimeToAdmins('notification')

  return NextResponse.json({
    post: { id: updated.id, title: updated.title, content: publicContentImageMarkers(updated.content), moderationStatus: updated.moderationStatus, updatedAt: updated.updatedAt },
    moderationStatus: updated.moderationStatus,
    message: isAdmin ? '帖子已保存' : '修改已保存，正在等待审核，审核通过后会重新展示。',
  })
}
