import { NextResponse } from 'next/server'
import { publicImageUrl, storedImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireAdmin, sanitizeText } from '@/lib/security'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 100

export async function GET(request: Request) {
  const guard = await requireAdmin('board_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/boards:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  const rawPage = Number(searchParams.get('page') || 1)
  const rawLimit = Number(searchParams.get('limit') || DEFAULT_PAGE_SIZE)
  const page = Number.isSafeInteger(rawPage) ? Math.min(10_000, Math.max(rawPage, 1)) : 1
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE
  const skip = (page - 1) * limit

  const boards = await prisma.board.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    skip,
    take: limit + 1,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      coverUrl: true,
      sortOrder: true,
      postCount: true,
      followerCount: true,
      isActive: true,
      isHot: true,
      isRecommended: true,
      createdAt: true,
      updatedAt: true,
      categoryId: true,
      parentId: true,
      BoardCategory: { select: { id: true, name: true, slug: true } },
      Board: { select: { id: true, name: true, slug: true } },
    },
  })
  const hasMore = boards.length > limit

  const visibleBoards = hasMore ? boards.slice(0, limit) : boards
  return NextResponse.json({ boards: visibleBoards.map((board) => ({ ...board, coverUrl: publicImageUrl(board.coverUrl) })), page, limit, hasMore })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('board_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/boards:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  })
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const name = sanitizeText(body?.name, 40)
  const slug = sanitizeText(body?.slug, 60).toLowerCase()

  if (!name || !slug) {
    return NextResponse.json({ message: '板块名称和 slug 不能为空' }, { status: 400 })
  }

  const board = await prisma.board.create({
    data: {
      name,
      slug,
      description: sanitizeText(body?.description, 180) || null,
      coverUrl: storedImageUrl(sanitizeText(body?.coverUrl, 500)) || null,
      sortOrder: Number(body?.sortOrder || 0),
      categoryId: sanitizeText(body?.categoryId, 80) || null,
      parentId: sanitizeText(body?.parentId, 80) || null,
      isHot: Boolean(body?.isHot),
      isRecommended: Boolean(body?.isRecommended),
    },
  })

  await prisma.adminAction.create({
    data: {
      adminId: guard.user.id,
      action: 'CREATE_BOARD',
      boardId: board.id,
      reason: '创建板块',
    },
  })

  return NextResponse.json({ board: { ...board, coverUrl: publicImageUrl(board.coverUrl) } }, { status: 201 })
}
