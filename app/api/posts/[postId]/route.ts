import { NextResponse } from 'next/server'
import { awardFeaturedPostRewards } from '@/lib/community-rewards'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { checkForbiddenWords } from '@/lib/content-filter'
import { MAX_CONTENT_IMAGES } from '@/lib/content-images'
import { isSupabaseStorageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { publicPostWhere } from '@/lib/post-moderation'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { containsSensitiveContent, isAdminRole, requireUser, sanitizeText } from '@/lib/security'

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
  const post = await prisma.post.findFirst({
    where: {
      ...publicPostWhere,
      id: postId,
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    },
    include: {
      User: {
        select: {
          id: true,
          nickname: true,
          level: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
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
              level: true,
              avatarUrl: true,
              Profile: { select: { displayName: true, avatarUrl: true } },
            },
          },
        },
      },
    },
  })

  if (!post) {
    return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  }

  const { User, Board, Reply, ...postData } = post
  const remarkMap = await loadFriendRemarkMap(viewer?.id, [User.id, ...Reply.map((reply) => reply.User.id)])
  const author = User.Profile ? {
    ...User,
    Profile: {
      ...User.Profile,
      displayName: resolveFriendDisplayName({
        viewerId: viewer?.id,
        targetUserId: User.id,
        fallbackName: getPublicUserDisplayName(User),
        remarkMap,
      }),
    },
  } : User
  return NextResponse.json({
    post: {
      ...postData,
      author,
      board: Board,
      replies: Reply.map(({ User: replyAuthor, ...reply }) => ({
        ...reply,
        author: replyAuthor.Profile ? {
          ...replyAuthor,
          Profile: {
            ...replyAuthor.Profile,
            displayName: resolveFriendDisplayName({
              viewerId: viewer?.id,
              targetUserId: replyAuthor.id,
              fallbackName: getPublicUserDisplayName(replyAuthor),
              remarkMap,
            }),
          },
        } : replyAuthor,
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

  const isAdmin = isAdminRole(guard.user.role)
  const isOwner = existing.authorId === guard.user.id

  // 编辑意图：请求体带有标题 / 正文 / 媒体（保留或新增）字段。
  const wantsEdit =
    typeof body.title === 'string' ||
    typeof body.content === 'string' ||
    Array.isArray(body.keepMediaIds) ||
    Array.isArray(body.addImageUrls)
  if (wantsEdit) return handleEditPost(request, { postId, existing, user: guard.user, isAdmin, isOwner, body })

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
  const canManagePosts = changesModeration && await hasAdminPermission(guard.user, 'post_manage')
  if (changesModeration && !canManagePosts) {
    return NextResponse.json({ message: '只有管理员可以置顶或精选帖子' }, { status: 403 })
  }
  if (data.isDeleted !== undefined) {
    if (data.isDeleted && !isOwner && !isAdmin) {
      return NextResponse.json({ message: '只能删除自己发布的帖子' }, { status: 403 })
    }
    if (!data.isDeleted && !isAdmin) {
      return NextResponse.json({ message: '只有管理员可以恢复帖子' }, { status: 403 })
    }
  }

  const post = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const lockedExisting = await tx.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, boardId: true, isDeleted: true, isFeatured: true },
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

    if (isAdmin) {
      let action: 'DELETE_POST' | 'RESTORE_POST' | 'PIN_POST' | 'UNPIN_POST' | 'FEATURE_POST' | 'UNFEATURE_POST' = 'FEATURE_POST'
      if (data.isDeleted !== undefined) action = data.isDeleted ? 'DELETE_POST' : 'RESTORE_POST'
      else if (data.isPinned !== undefined) action = data.isPinned ? 'PIN_POST' : 'UNPIN_POST'
      else if (data.isFeatured !== undefined) action = data.isFeatured ? 'FEATURE_POST' : 'UNFEATURE_POST'

      await tx.adminAction.create({
        data: {
          adminId: guard.user.id,
          postId,
          action,
          metadata: data,
        },
      })
    }

    return updated
  })

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
  user: { id: string; role: string }
  isAdmin: boolean
  isOwner: boolean
  body: Record<string, unknown>
}

async function handleEditPost(
  request: Request,
  ctx: EditContext,
) {
  const { postId, existing, isAdmin, isOwner, body } = ctx

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ message: '只能编辑自己发布的帖子' }, { status: 403 })
  }

  const rawTitle = sanitizeText(typeof body.title === 'string' ? body.title : existing.title, 120)
  const rawContent = stripUnsafeHtml(sanitizeText(typeof body.content === 'string' ? body.content : existing.content, 20000))
  const hasSticker = Boolean(existing.stickerId)

  if (checkForbiddenWords(`${rawTitle}\n${rawContent}`).blocked) {
    return NextResponse.json({ message: '内容包含不允许使用的词语，请修改后重新提交。' }, { status: 400 })
  }
  if (await containsSensitiveContent(`${rawTitle}\n${rawContent}`)) {
    return NextResponse.json({ message: '帖子包含违禁词，无法保存', errors: { content: '请修改后重新保存' } }, { status: 400 })
  }

  const errors: Record<string, string> = {}
  if (rawTitle.length < 3) errors.title = '标题至少需要 3 个字符'
  if (!hasSticker && rawContent.length < 5) errors.content = '正文至少需要 5 个字符'

  // 解析并校验媒体变更。
  const keepMediaIds = Array.isArray(body.keepMediaIds)
    ? body.keepMediaIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, MAX_CONTENT_IMAGES)
    : null
  const addImageUrls = Array.isArray(body.addImageUrls)
    ? body.addImageUrls.filter(isAcceptableImageUrl).slice(0, MAX_CONTENT_IMAGES)
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
  const removedCount = currentMedia.length - keptIds.length
  const keptCount = keptIds.length
  if (keptCount + addImageUrls.length > MAX_CONTENT_IMAGES) {
    errors.media = `图片数量不能超过 ${MAX_CONTENT_IMAGES} 张`
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ message: '请检查帖子内容', errors }, { status: 400 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPost = await tx.post.update({
      where: { id: postId },
      data: {
        title: rawTitle,
        content: rawContent,
        summary: createSummary(rawContent),
        // 审核状态、点赞、评论、浏览、收藏、置顶/精选等字段一律保持不变（update 时未提供即不修改）。
      },
      select: { id: true, title: true, content: true, updatedAt: true },
    })

    // 删除被移除的图片（keepMediaIds 显式排除的）。
    if (removedCount > 0) {
      await tx.postMedia.deleteMany({
        where: { postId, type: 'IMAGE', id: { notIn: keptIds } },
      })
    }

    // 重新规整保留图片的排序，再追加新图片。
    const keptMedia = currentMedia.filter((media) => keptIds.includes(media.id))
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

    return updatedPost
  })

  return NextResponse.json({
    post: { id: updated.id, title: updated.title, content: updated.content, updatedAt: updated.updatedAt },
    message: '帖子已保存',
  })
}
