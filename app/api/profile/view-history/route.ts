import { NextResponse } from 'next/server'
import { toPublicMediaUrl } from '@/lib/media-url'
import { buildPublicPostWhere } from '@/lib/post-moderation'
import { getProfileRecordPagination, PROFILE_RECORD_PAGE_SIZE } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'
import { publicModerationText } from '@/lib/content-moderation'
import { rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }
const SUPPORTED_TYPES = ['POST'] as const
const KNOWN_TYPES = new Set(['POST', 'SALON', 'ASPIRIN', 'BEETHOVEN'])

function readPage(value: string | null) {
  return Math.min(10_000, Math.max(1, Number.parseInt(value || '1', 10) || 1))
}

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  const requestedType = params.get('entityType')
  const page = readPage(params.get('page'))
  const query = (params.get('q') || '').trim().slice(0, 100)
  if (requestedType && !KNOWN_TYPES.has(requestedType)) {
    return NextResponse.json({ message: '浏览历史类型无效' }, { status: 400, headers: PRIVATE_HEADERS })
  }
  if (requestedType && requestedType !== 'POST') {
    return NextResponse.json({
      items: [],
      pagination: getProfileRecordPagination(0, page),
      supportedTypes: [...SUPPORTED_TYPES],
    }, { headers: PRIVATE_HEADERS })
  }

  try {
    const where = {
      userId: guard.user.id,
      Post: {
        AND: [
          buildPublicPostWhere(),
          { User: { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } } },
          ...(query ? [{ OR: [{ title: { contains: query } }, { content: { contains: query } }] }] : []),
        ],
      },
    }
    const total = await prisma.profilePostViewHistory.count({ where })
    const pagination = getProfileRecordPagination(total, page, PROFILE_RECORD_PAGE_SIZE)
    const rows = await prisma.profilePostViewHistory.findMany({
      where,
      orderBy: [{ viewedAt: 'desc' }, { id: 'desc' }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        postId: true,
        viewedAt: true,
        Post: {
          select: {
            title: true,
            moderationStatus: true,
            PostMedia: {
              where: { type: 'IMAGE' },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              take: 1,
              select: { url: true, thumbnail: true },
            },
          },
        },
      },
    })
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        entityType: 'POST',
        entityId: row.postId,
        viewedAt: row.viewedAt.toISOString(),
        title: publicModerationText(row.Post.title, row.Post.moderationStatus),
        previewUrl: toPublicMediaUrl(row.Post.PostMedia[0]?.thumbnail || row.Post.PostMedia[0]?.url),
      })),
      pagination,
      supportedTypes: [...SUPPORTED_TYPES],
    }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[profile.view-history.read]', { userId: guard.user.id, errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '浏览历史暂时无法加载，请稍后重试' }, { status: 503, headers: PRIVATE_HEADERS })
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null) as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ message: '浏览记录参数无效' }, { status: 400, headers: PRIVATE_HEADERS })
  }
  const record = body as Record<string, unknown>
  const entityId = typeof record.entityId === 'string' ? record.entityId.trim() : ''
  if (record.entityType !== 'POST' || !entityId || entityId.length > 191) {
    return NextResponse.json({ message: '浏览记录参数无效' }, { status: 400, headers: PRIVATE_HEADERS })
  }

  try {
    const visiblePost = await prisma.post.findFirst({
      where: {
        ...buildPublicPostWhere(),
        id: entityId,
        User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      },
      select: { id: true },
    })
    if (!visiblePost) return NextResponse.json({ message: '帖子不存在或不可用' }, { status: 404, headers: PRIVATE_HEADERS })

    await prisma.profilePostViewHistory.upsert({
      where: { userId_postId: { userId: guard.user.id, postId: visiblePost.id } },
      create: { userId: guard.user.id, postId: visiblePost.id },
      update: { viewedAt: new Date() },
      select: { id: true },
    })
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[profile.view-history.write]', { userId: guard.user.id, errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '浏览记录暂时无法保存，请稍后重试' }, { status: 503, headers: PRIVATE_HEADERS })
  }
}
