import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { DELETE as deleteReply } from '@/app/api/replies/[replyId]/route'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireRequestAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'
const pageSize = 25

export async function GET(request: Request) {
  const guard = await requireRequestAdmin(request, 'reply_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const keyword = sanitizeText(params.get('keyword'), 80).trim()
  const state = params.get('state')
  const rawPage = Number(params.get('page'))
  const page = Number.isSafeInteger(rawPage) ? Math.min(1000, Math.max(1, rawPage)) : 1
  const where: Prisma.ReplyWhereInput = {
    ...(state === 'deleted' ? { isDeleted: true } : state === 'all' ? {} : { isDeleted: false }),
    ...(params.get('reported') === '1' ? { Report: { some: {} } } : {}),
    ...(keyword ? { OR: [{ id: keyword }, { postId: keyword }, { content: { contains: keyword } }, { User: { nickname: { contains: keyword } } }] } : {}),
  }
  const rows = await prisma.reply.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
    select: {
      id: true, content: true, createdAt: true, isDeleted: true, moderationStatus: true, moderationReason: true,
      User: { select: { uid: true, nickname: true } },
      Post: { select: { id: true, title: true } },
      Report: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, reason: true } },
      AdminAction: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, reason: true, createdAt: true } },
    },
  })
  return NextResponse.json({ items: rows.slice(0, pageSize), page, hasMore: page < 1000 && rows.length > pageSize }, {
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' },
  })
}

export async function DELETE(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireRequestAdmin(request, 'reply_manage')
  if (!guard.user) return guard.response
  const replyId = sanitizeText(new URL(request.url).searchParams.get('id'), 80).trim()
  if (!replyId) return NextResponse.json({ message: '评论 ID 无效' }, { status: 400 })
  const response = await deleteReply(request, { params: Promise.resolve({ replyId }) })
  if (response.status === 404 && (await response.clone().json()).code === 'REPLY_ALREADY_DELETED') {
    return NextResponse.json({ code: 'REPLY_ALREADY_DELETED', message: '评论已被删除，请刷新查看最新状态' }, { status: 409 })
  }
  return response
}
