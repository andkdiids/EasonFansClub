import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { POINTS, calcLevel } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, sanitizeText } from '@/lib/security'

type Params = { params: Promise<{ postId: string }> }

export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再回复' }, { status: 401 })

  const { postId } = await params
  const body = await request.json().catch(() => null)
  const content = await filterSensitiveWords(sanitizeText(body?.content, 5000))
  const parentId = sanitizeText(body?.parentId, 80)

  if (content.length < 2) {
    return NextResponse.json({ message: '回复内容至少需要 2 个字符', errors: { content: '回复太短了' } }, { status: 400 })
  }

  const post = await prisma.post.findFirst({
    where: { id: postId, isDeleted: false, status: 'PUBLISHED' },
    select: { id: true },
  })
  if (!post) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })

  const reply = await prisma.$transaction(async (tx) => {
    const currentUser = await tx.user.findFirstOrThrow({
      where: { id: user.id, status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      select: { points: true, exp: true },
    })
    const nextPoints = currentUser.points + POINTS.replyCreate
    const nextExp = currentUser.exp + POINTS.replyCreate

    const createdReply = await tx.reply.create({
      data: {
        postId,
        authorId: user.id,
        content,
        parentId: parentId || null,
      },
      select: { id: true },
    })

    await tx.post.update({
      where: { id: postId },
      data: { replyCount: { increment: 1 } },
    })

    await tx.user.update({
      where: { id: user.id },
      data: { points: nextPoints, exp: nextExp, level: calcLevel(nextPoints + nextExp) },
    })

    await tx.pointLog.create({
      data: {
        userId: user.id,
        action: 'REPLY_CREATE',
        points: POINTS.replyCreate,
        before: currentUser.points,
        after: nextPoints,
        postId,
        replyId: createdReply.id,
        reason: '回复帖子',
      },
    })

    return createdReply
  })

  return NextResponse.json({ reply }, { status: 201 })
}
