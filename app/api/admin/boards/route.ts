import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function GET() {
  const guard = await requireAdmin('board_manage')
  if (!guard.user) return guard.response

  const boards = await prisma.board.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { category: true, parent: true },
  })

  return NextResponse.json({ boards })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('board_manage')
  if (!guard.user) return guard.response

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
      coverUrl: sanitizeText(body?.coverUrl, 500) || null,
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

  return NextResponse.json({ board }, { status: 201 })
}
