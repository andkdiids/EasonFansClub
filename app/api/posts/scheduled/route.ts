import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

function positiveQuery(value: string | null, fallback: number, maximum: number) {
  if (value === null || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const search = new URL(request.url).searchParams
  const page = positiveQuery(search.get('page'), 1, 100_000)
  const pageSize = positiveQuery(search.get('pageSize'), 20, 50)
  const skip = (page - 1) * pageSize

  try {
    const where = { authorId: guard.user.id, isDeleted: false, publicationStatus: 'SCHEDULED' as const, scheduledPublishAt: { not: null } }
    const [total, rows] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where, orderBy: [{ scheduledPublishAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], skip, take: pageSize,
        select: { id: true, title: true, content: true, summary: true, scheduledPublishAt: true, moderationStatus: true, createdAt: true, Board: { select: { name: true } } },
      }),
    ])
    const posts = rows.flatMap((row) => row.scheduledPublishAt ? [{
      id: row.id, title: row.title, content: row.content, summary: row.summary || row.content.slice(0, 240),
      scheduledPublishAt: row.scheduledPublishAt.toISOString(), publicationStatus: 'SCHEDULED' as const,
      moderationStatus: row.moderationStatus, boardName: row.Board.name, coverUrl: null, createdAt: row.createdAt.toISOString(),
    }] : [])
    return NextResponse.json({ posts, page, pageSize, total, hasMore: skip + rows.length < total }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' },
    })
  } catch (error) {
    console.error('[posts.scheduled.list.failed]', { userId: guard.user.id, error: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ message: '待发布内容暂时无法读取，请稍后重试' }, { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  }
}
