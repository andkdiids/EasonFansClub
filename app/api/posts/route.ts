import { NextResponse } from 'next/server'
import { syncUserAchievements } from '@/lib/achievements'
import { createPostModerationHistory } from '@/lib/admin-audit'
import { getCurrentUser, isAuthServiceUnavailableError } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { emitRealtimeToAdmins } from '@/lib/realtime'
import { sanitizeText } from '@/lib/security'
import { hasTooManyContentImages, MAX_CONTENT_IMAGES, parseContentImageUrls, publicContentImageMarkers } from '@/lib/content-images'
import { publicImageUrl } from '@/lib/images'
import { isStickerVisible, recordStickerUsage } from '@/lib/sticker-center'
import { publicPostWhere } from '@/lib/post-moderation'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'
import { CONTENT_CONTAINS_BANNED_WORD, checkPostForbiddenWords, formatPostForbiddenWordFieldErrors, formatPostForbiddenWordMessage, publicModerationText, shouldBypassForbiddenWords } from '@/lib/content-moderation'

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

class PostCreateBusinessError extends Error {
  constructor(readonly reason: 'AUTH_SESSION_EXPIRED') {
    super(reason)
    this.name = 'PostCreateBusinessError'
  }
}

type ErrorLike = {
  name?: unknown
  code?: unknown
  message?: unknown
  stack?: unknown
  meta?: unknown
}

function redactPostCreateLogText(value: string) {
  return value
    .replace(/\b(?:mysql|mariadb|postgres(?:ql)?|prisma(?:\+postgres)?):\/\/[^\s'\"]+/gi, (match) => `${match.slice(0, match.indexOf('://') + 3)}[redacted]`)
    .replace(/\b(password|passwd|secret|token|cookie|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 4000)
}

function describePostCreateError(error: unknown) {
  const value = error as ErrorLike
  const meta = value?.meta && typeof value.meta === 'object' ? value.meta as Record<string, unknown> : null
  const message = typeof value?.message === 'string' ? value.message : String(error)
  const stack = typeof value?.stack === 'string' ? value.stack : undefined
  return {
    name: typeof value?.name === 'string' ? value.name : undefined,
    code: typeof value?.code === 'string' || typeof value?.code === 'number' ? value.code : undefined,
    message: redactPostCreateLogText(message),
    stack: stack ? redactPostCreateLogText(stack) : undefined,
    meta: meta ? {
      code: typeof meta.code === 'string' || typeof meta.code === 'number' ? meta.code : undefined,
      modelName: typeof meta.modelName === 'string' ? meta.modelName : undefined,
      table: typeof meta.table === 'string' ? meta.table : undefined,
      field_name: typeof meta.field_name === 'string' ? meta.field_name : undefined,
    } : undefined,
  }
}

function prismaErrorCode(error: unknown) {
  const code = (error as ErrorLike)?.code
  return typeof code === 'string' ? code : null
}

function logPostCreateError(phase: string, error: unknown, userId?: string, boardId?: string) {
  console.error('[posts.create]', {
    phase,
    userId,
    boardId,
    error: describePostCreateError(error),
  })
}

async function runPostCreateSideEffect(
  phase: string,
  operation: () => Promise<unknown>,
  userId: string,
  boardId: string,
) {
  try {
    await operation()
  } catch (error) {
    logPostCreateError(phase, error, userId, boardId)
  }
}

export async function GET(request: Request) {
  const viewer = await getCurrentUser()
  const { searchParams } = new URL(request.url)
  const boardSlug = searchParams.get('board')
  const page = Math.max(Number(searchParams.get('page') || 1), 1)
  const take = Math.min(Number(searchParams.get('take') || 20), 50)
  const skip = (page - 1) * take

  try {
    const rows = await prisma.post.findMany({
      where: {
        ...publicPostWhere,
        User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
        ...(boardSlug ? { Board: { slug: boardSlug } } : {}),
      },
      orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: take + 1,
      select: {
        id: true,
        title: true,
        summary: true,
        content: true,
        moderationStatus: true,
        ipRegion: true,
        likeCount: true,
        favoriteCount: true,
        replyCount: true,
        viewCount: true,
        isPinned: true,
        isFeatured: true,
        createdAt: true,
          User: {
            select: {
              id: true,
              uid: true,
            nickname: true,
            usernameModerationStatus: true,
            nicknameModerationStatus: true,
            nicknameViolationDisplay: true,
            avatarUrl: true,
            level: true,
            Profile: { select: { avatarUrl: true, displayName: true, displayNameModerationStatus: true } },
          },
        },
        Board: { select: { name: true, slug: true } },
        sticker: { select: { url: true } },
      },
    })
    const hasMore = rows.length > take
    const pageRows = hasMore ? rows.slice(0, take) : rows
    const remarkMap = await loadFriendRemarkMap(viewer?.id, pageRows.map((row) => row.User.id))
    const posts = pageRows.map(({ summary, content, moderationStatus, User, Board, sticker, ...post }) => ({
      ...post,
      title: publicModerationText(post.title, moderationStatus),
      author: {
        ...User,
        nickname: getPublicUserDisplayName(User),
        avatarUrl: publicImageUrl(User.avatarUrl),
        profile: User.Profile ? {
          ...User.Profile,
          avatarUrl: publicImageUrl(User.Profile.avatarUrl),
          displayName: resolveFriendDisplayName({
            viewerId: viewer?.id,
            targetUserId: User.id,
            fallbackName: getPublicUserDisplayName(User),
            remarkMap,
          }),
        } : User.Profile,
      },
      board: Board,
      content: publicModerationText(publicContentImageMarkers(summary || createSummary(content)), moderationStatus),
      stickerUrl: publicImageUrl(sticker?.url),
    }))

    return NextResponse.json(
      { posts, page, hasMore },
      { headers: viewer
        ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }
        : { 'Cache-Control': 'public, max-age=15, s-maxage=45, stale-while-revalidate=120', Vary: 'Cookie' } },
    )
  } catch (error) {
    console.error('[posts:list:error]', { boardSlug, page, error })
     return NextResponse.json({ message: '\u52a0\u8f7d\u5e16\u5b50\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5', posts: [], page, hasMore: false }, { status: 503 })
  }
}

export async function POST(request: Request) {
  let phase = 'auth'
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null

  try {
    user = await getCurrentUser()
  } catch (error) {
    logPostCreateError(phase, error)
    return NextResponse.json(
      { message: isAuthServiceUnavailableError(error) ? '\u767b\u5f55\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5' : '\u53d1\u5e03\u5e16\u5b50\u6682\u65f6\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5' },
      { status: 503 },
    )
  }

  if (!user) {
    return NextResponse.json({ message: '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55' }, { status: 401 })
  }

  phase = 'parse-request'
  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_REQUEST_BODY')
    body = parsed as Record<string, unknown>
  } catch (error) {
    logPostCreateError(phase, error, user.id)
    return NextResponse.json({ message: '\u8bf7\u6c42\u5185\u5bb9\u65e0\u6548\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5' }, { status: 400 })
  }

  const rawTitle = sanitizeText(body.title, 120)
  const rawContent = stripUnsafeHtml(sanitizeText(body.content, 20000))
  const rawStickerId = typeof body.stickerId === 'string' && body.stickerId ? body.stickerId.trim().slice(0, 191) : null
  const isAdmin = shouldBypassForbiddenWords(user)
  const input = {
    boardId: sanitizeText(body.boardId, 80),
    title: rawTitle,
    content: rawContent,
  }

  try {
    phase = 'content-moderation'
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

    phase = 'sticker-validation'
    if (rawStickerId && !(await isStickerVisible(rawStickerId))) {
      return NextResponse.json({ message: '\u8d34\u56fe\u4e0d\u5b58\u5728\u6216\u5df2\u4e0b\u67b6', errors: { stickerId: '\u5f53\u524d\u8d34\u56fe\u4e0d\u53ef\u7528' } }, { status: 400 })
    }

    phase = 'input-validation'
    if (hasTooManyContentImages(body?.imageUrls)) {
      return NextResponse.json({
        message: `\u56fe\u7247\u6570\u91cf\u4e0d\u80fd\u8d85\u8fc7 ${MAX_CONTENT_IMAGES} \u5f20\u56fe\u7247`,
        errors: { imageUrls: `\u6700\u591a\u4e0a\u4f20 ${MAX_CONTENT_IMAGES} \u5f20\u56fe\u7247` },
      }, { status: 400 })
    }
    const imageUrls = parseContentImageUrls(body.imageUrls)
    const errors: Record<string, string> = {}
    if (!input.boardId) errors.boardId = '\u8bf7\u9009\u62e9\u6709\u6548\u677f\u5757'
    if (input.title.length < 3) errors.title = '\u6807\u9898\u4e0d\u80fd\u5c11\u4e8e 3 \u4e2a\u5b57'
    // 缂備胶铏庨崹鐢稿Υ閸愵喖绠氶柛娑卞幘閻燁垶鏌ㄥ☉妯煎缂侇喖閰ｅ畷锝夊箣閿旂懓浜惧ù锝咁潟閳ь剙鍟撮獮鍡涘川椤撶偟妯侀梺闈涙閻掞箑螞閵堝拋娼伴柨婵嗘閻庮噣鏌ㄥ☉姗嗘Ц闁告ɑ鍨归幏瀣矙閸喚宀涢柣銏╁灠閸犳稓妲愰柆宥呯闁哄牏鏁哥粙鍥煙椤栨碍鍣归柛鐘茶嫰椤垽鏁愰崱妯尖偓顕€鏌ゅ畡鏉挎毐闁?5 婵炴垶鎼╂禍婊堟偤瑜忕划顓㈡晜鐞涒€充壕?
    if (!rawStickerId && input.content.length < 5) errors.content = '\u6b63\u6587\u4e0d\u80fd\u5c11\u4e8e 5 \u4e2a\u5b57'
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ message: '\u8bf7\u68c0\u67e5\u5e16\u5b50\u5185\u5bb9', errors }, { status: 400 })
    }

    phase = 'board-validation'
    const board = await prisma.board.findFirst({
      where: { id: input.boardId, isActive: true },
      select: { id: true, slug: true },
    })
    if (!board) {
      return NextResponse.json({ message: '\u677f\u5757\u4e0d\u5b58\u5728\u6216\u5df2\u7981\u7528', errors: { boardId: '\u8bf7\u9009\u62e9\u6709\u6548\u677f\u5757' } }, { status: 404 })
    }
    if (board.slug === 'announcements' && !await hasAdminPermission(user, 'post_manage')) {
      return NextResponse.json(
        { message: '\u53ea\u6709\u7ba1\u7406\u5458\u53ef\u4ee5\u5728\u516c\u544a\u533a\u53d1\u5e03\u5185\u5bb9', errors: { boardId: '\u666e\u901a\u7528\u6237\u4e0d\u80fd\u9009\u62e9\u516c\u544a\u533a' } },
        { status: 403 },
      )
    }

    const canPublishImmediately = isAdmin
    const moderationStatus = canPublishImmediately ? 'APPROVED' as const : 'PENDING' as const

    // IP metadata is optional. A provider, proxy header, or parser failure must
    // never prevent the primary post transaction from running.
    phase = 'ip-location'
    let ipLocation: Awaited<ReturnType<typeof resolveIpLocation>> = null
    try {
      ipLocation = await resolveIpLocation(request)
    } catch (error) {
      logPostCreateError('ip-location', error, user.id, input.boardId)
    }
    const ipRegion = ipLocation?.label || null

    phase = 'post-transaction'
    const result = await prisma.$transaction(async (tx) => {
      phase = 'post-transaction.user-state'
      const activeUser = await tx.user.findFirst({
        where: { id: user.id, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
        select: { id: true },
      })
      if (!activeUser) throw new PostCreateBusinessError('AUTH_SESSION_EXPIRED')

      phase = 'post-transaction.post-create'
      const post = await tx.post.create({
        data: {
          boardId: input.boardId,
          authorId: user.id,
          title: input.title,
          content: input.content,
          ipRegion,
          summary: createSummary(input.content),
          status: 'PUBLISHED',
          moderationStatus,
          stickerId: rawStickerId || undefined,
        },
        select: { id: true, moderationStatus: true },
      })
      if (imageUrls.length) {
        phase = 'post-transaction.media-create'
        await tx.postMedia.createMany({ data: imageUrls.map((url, sortOrder) => ({ postId: post.id, type: 'IMAGE', url, sortOrder })) })
      }

      return { post }
    })

    // The post and its media are the primary transaction. Audit history,
    // notifications, counters, activity, rewards/achievements and IP profile
    // metadata are deliberately isolated so an optional table or side effect
    // cannot roll back a successfully-created post.
    const detailUrl = `/posts/${result.post.id}`
    await Promise.all([
      runPostCreateSideEffect('moderation-history', () => createPostModerationHistory(prisma, {
        postId: result.post.id,
        actorId: user.id,
        action: 'SUBMITTED',
        status: moderationStatus,
        titleSnapshot: input.title,
      }), user.id, input.boardId),
      moderationStatus === 'APPROVED'
        ? runPostCreateSideEffect('friend-activity', () => prisma.friendActivity.create({ data: { actorId: user.id, type: 'POST', content: input.title, targetUrl: `/posts/${result.post.id}` } }), user.id, input.boardId)
        : runPostCreateSideEffect('moderation-notification', async () => {
          const admins = await prisma.user.findMany({
            where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
            select: { id: true },
          })
          if (!admins.length) return
          await prisma.notification.createMany({
            data: admins.map((admin) => ({
              recipientId: admin.id,
              type: 'ADMIN' as const,
              title: '新帖子待审核',
              content: input.title,
              link: '/admin/posts/review',
              key: `post-review:${result.post.id}`,
            })),
            skipDuplicates: true,
          })
        }, user.id, input.boardId),
      moderationStatus === 'APPROVED'
        ? runPostCreateSideEffect('board-counter', () => prisma.board.update({ where: { id: input.boardId }, data: { postCount: { increment: 1 } } }), user.id, input.boardId)
        : Promise.resolve(),
      rawStickerId
        ? runPostCreateSideEffect('sticker-usage', () => recordStickerUsage(user.id, rawStickerId), user.id, input.boardId)
        : Promise.resolve(),
      runPostCreateSideEffect('ip-region', () => updateUserIpRegion(user.id, ipLocation), user.id, input.boardId),
      moderationStatus === 'PENDING'
        ? runPostCreateSideEffect('admin-realtime', () => emitRealtimeToAdmins('notification'), user.id, input.boardId)
        : Promise.resolve(),
      runPostCreateSideEffect('achievement-sync', () => syncUserAchievements(user.id, ['POST']), user.id, input.boardId),
    ])

    return NextResponse.json({
      post: { ...result.post, detailUrl },
      detailUrl,
      moderationStatus,
      message: moderationStatus === 'PENDING' ? '\u5e16\u5b50\u5df2\u63d0\u4ea4\uff0c\u5f85\u5ba1\u6838\u540e\u5c06\u516c\u5f00' : '\u5e16\u5b50\u53d1\u5e03\u6210\u529f',
    }, { status: 201 })
  } catch (error) {
    logPostCreateError(phase, error, user.id, input.boardId)
    if (error instanceof PostCreateBusinessError && error.reason === 'AUTH_SESSION_EXPIRED') {
      return NextResponse.json({ message: '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55' }, { status: 401 })
    }
    const code = prismaErrorCode(error)
    if (code === 'P2002') {
      return NextResponse.json({ message: '\u5e16\u5b50\u63d0\u4ea4\u53d1\u751f\u51b2\u7a81\uff0c\u8bf7\u52ff\u91cd\u590d\u63d0\u4ea4' }, { status: 409 })
    }
    if (code === 'P2003') {
      return NextResponse.json({ message: '\u677f\u5757\u6216\u7528\u6237\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5' }, { status: 409 })
    }
    if (code === 'P2021') {
      return NextResponse.json({ message: '\u670d\u52a1\u7aef\u6570\u636e\u7ed3\u6784\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458' }, { status: 503 })
    }
    return NextResponse.json({ message: '\u53d1\u5e03\u5e16\u5b50\u6682\u65f6\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5' }, { status: 503 })
  }
}
