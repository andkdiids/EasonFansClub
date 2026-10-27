import { NextResponse } from 'next/server'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const ADMIN_DISCUSSION_PAGE_SIZE = 30

export async function GET(request: Request) {
  const guard = await requireAdmin('activity_manage', request)
  if (!guard.user) return guard.response

  const search = new URL(request.url).searchParams
  const cursor = search.get('cursor')
  if (cursor && cursor.length > 191) return NextResponse.json({ message: '分页位置无效' }, { status: 400 })

  try {
    const where = { isDeleted: false }
    if (cursor) {
      const cursorRow = await prisma.concertDiscussionComment.findFirst({ where: { ...where, id: cursor }, select: { id: true } })
      if (!cursorRow) return NextResponse.json({ message: '分页位置已失效，请刷新列表' }, { status: 400 })
    }
    const rows = await prisma.concertDiscussionComment.findMany({
      where,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ADMIN_DISCUSSION_PAGE_SIZE + 1,
      select: {
        id: true,
        content: true,
        createdAt: true,
        moderationStatus: true,
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true } },
        author: { select: { nickname: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, Profile: { select: { avatarUrl: true } } } },
        event: { select: { title: true, slug: true } },
        show: { select: { id: true, date: true, title: true, albumTitle: true } },
      },
    })
    const hasMore = rows.length > ADMIN_DISCUSSION_PAGE_SIZE
    const page = rows.slice(0, ADMIN_DISCUSSION_PAGE_SIZE)
    return NextResponse.json({
      comments: page.map((row) => ({
        id: row.id,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        moderationStatus: row.moderationStatus,
        event: row.event,
        show: row.show ? { id: row.show.id, date: row.show.date.toISOString().slice(0, 10), title: row.show.title, albumTitle: row.show.albumTitle } : null,
        author: { displayName: getPublicUserDisplayName(row.author), avatarUrl: publicImageUrl(row.author.Profile?.avatarUrl || row.author.avatarUrl) },
        images: row.images.map((image) => ({ id: image.id, url: publicImageUrl(image.url) })).filter((image) => image.url),
      })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.concert-discussions.read]', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : undefined,
    })
    return NextResponse.json({ message: '讨论列表暂时无法加载，请稍后重试' }, { status: 503 })
  }
}
