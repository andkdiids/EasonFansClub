import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdminRole, requireUser } from '@/lib/security'

type Params = { params: Promise<{ postId: string }> }

const POST_DETAIL_REPLY_LIMIT = 50

export async function GET(_request: Request, { params }: Params) {
  const { postId } = await params
  const post = await prisma.post.findFirst({
    where: { id: postId, isDeleted: false },
    include: {
      author: { select: { id: true, nickname: true, level: true, avatarUrl: true } },
      board: { select: { name: true, slug: true } },
      replies: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        take: POST_DETAIL_REPLY_LIMIT,
        include: { author: { select: { nickname: true, level: true, avatarUrl: true } } },
      },
    },
  })

  if (!post) {
    return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  }

  return NextResponse.json({ post })
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { postId } = await params
  const body = await request.json().catch(() => null)
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

  const existing = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, boardId: true, isDeleted: true },
  })
  if (!existing) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })

  const isAdmin = isAdminRole(guard.user.role)
  const isOwner = existing.authorId === guard.user.id
  const changesModeration = data.isPinned !== undefined || data.isFeatured !== undefined
  if (changesModeration && !isAdmin) {
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
    const updated = await tx.post.update({
      where: { id: postId },
      data,
      select: { id: true, isPinned: true, isFeatured: true, isDeleted: true },
    })

    if (data.isDeleted !== undefined && existing.isDeleted !== data.isDeleted) {
      const postCount = await tx.post.count({
        where: { boardId: existing.boardId, status: 'PUBLISHED', isDeleted: false },
      })
      await tx.board.update({
        where: { id: existing.boardId },
        data: { postCount },
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
