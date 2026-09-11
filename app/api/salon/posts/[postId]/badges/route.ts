import { NextResponse } from 'next/server'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { SALON_BADGE_CLASSIFICATION, salonBadgeClassificationMessage } from '@/lib/salon-badges'
import { grantSalonBadge } from '@/lib/salon-badge-grant'

type RouteContext = { params: Promise<{ postId: string }> }

export const dynamic = 'force-dynamic'

const salonBadgeTargetSelect = {
  id: true,
  title: true,
  content: true,
  author: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      status: true,
      isDeleted: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
} as const

async function loadTarget(postId: string) {
  const post = await prisma.salonPost.findUnique({ where: { id: postId }, select: salonBadgeTargetSelect })
  if (!post) return { response: NextResponse.json({ ok: false, code: 'SALON_NOT_FOUND', message: '沙龙作品不存在或已删除' }, { status: 404 }) }
  if (!post.author || post.author.isDeleted || post.author.status !== 'ACTIVE') {
    return { response: NextResponse.json({ ok: false, code: 'AUTHOR_UNAVAILABLE', message: '沙龙作者不存在或已停用' }, { status: 409 }) }
  }
  return { post }
}

function serializeTarget(post: NonNullable<Awaited<ReturnType<typeof loadTarget>>['post']>) {
  return {
    user: {
      id: post.author.id,
      uid: post.author.uid,
      nickname: getPublicUserDisplayName(post.author),
      avatarUrl: publicImageUrl(post.author.Profile?.avatarUrl || post.author.avatarUrl),
    },
    salon: {
      id: post.id,
      title: post.title || '无标题作品',
      summary: (post.content || '').trim().replace(/\s+/g, ' ').slice(0, 180),
    },
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const target = await loadTarget(postId)
  if ('response' in target) return target.response
  return NextResponse.json({
    ok: true,
    classificationAvailable: SALON_BADGE_CLASSIFICATION.available,
    message: salonBadgeClassificationMessage(),
    ...serializeTarget(target.post),
    badges: [],
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const target = await loadTarget(postId)
  if ('response' in target) return target.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const badgeId = sanitizeText(body?.badgeId, 191)
  if (!badgeId) return NextResponse.json({ ok: false, code: 'BADGE_REQUIRED', message: '请选择要派发的勋章' }, { status: 400 })

  // Do not fall back to matching badge names or treating generic CONCERT
  // badges as Salon badges. There is no reliable classifier in this schema.
  if (!SALON_BADGE_CLASSIFICATION.available) {
    return NextResponse.json({ ok: false, code: 'SALON_BADGE_CLASSIFICATION_UNAVAILABLE', message: salonBadgeClassificationMessage() }, { status: 409 })
  }

  const result = await grantSalonBadge({ salonId: postId, userId: target.post.author.id, badgeId, adminUserId: guard.user.id })
  if (!result.created && !result.sourceAttached) return NextResponse.json({ ok: false, code: 'BADGE_ALREADY_OWNED', message: '该用户已拥有此勋章' }, { status: 409 })
  return NextResponse.json({ ok: true, ...result, ...serializeTarget(target.post), message: result.created ? `勋章已派发给「${getPublicUserDisplayName(target.post.author)}」` : '已为该用户补充沙龙管理员派发来源' }, { status: result.created ? 201 : 200 })
}
