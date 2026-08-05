import { NextResponse } from 'next/server'
import { startOfLocalDay } from '@/lib/checkin'
import { checkForbiddenWords } from '@/lib/content-filter'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function GET() {
  const guard = await requireAdmin('daily_message_manage')
  if (!guard.user) return guard.response

  try {
    const messages = await prisma.dailyMessage.findMany({
      orderBy: [{ date: 'desc' }, { isAdminMessage: 'desc' }, { sort: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        content: true,
        moderationStatus: true,
        isAdminMessage: true,
        sort: true,
        isDeleted: true,
        createdAt: true,
        User: { select: { id: true, nickname: true, uid: true } },
      },
    })
    return NextResponse.json({ messages })
  } catch (error) {
    console.error('[admin:registration-messages:list]', error)
    return NextResponse.json({ message: '留言加载失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireAdmin('daily_message_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const content = sanitizeText(body?.content, 300)
  if (!content) {
    return NextResponse.json({ message: '留言内容不能为空' }, { status: 400 })
  }
  if (checkForbiddenWords(content).blocked) {
    return NextResponse.json({ message: '内容包含不允许使用的词语，请修改后重新提交。' }, { status: 400 })
  }

  const moderationStatus = body?.moderationStatus === 'REJECTED' ? 'REJECTED' : 'APPROVED'
  const sort = Number(body?.sort) || 0
  const today = startOfLocalDay()

  try {
    const created = await prisma.dailyMessage.create({
      data: {
        userId: guard.user.id,
        date: today,
        content,
        isAdminMessage: true,
        moderationStatus,
        sort,
      },
      select: {
        id: true,
        content: true,
        moderationStatus: true,
        isAdminMessage: true,
        sort: true,
        isDeleted: true,
        createdAt: true,
        User: { select: { id: true, nickname: true, uid: true } },
      },
    })
    return NextResponse.json({ messageRow: created }, { status: 201 })
  } catch (error) {
    console.error('[admin:registration-messages:create]', error)
    return NextResponse.json({ message: '发布失败' }, { status: 500 })
  }
}
