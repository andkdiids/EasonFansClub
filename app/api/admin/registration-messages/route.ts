import { NextResponse } from 'next/server'
import { startOfLocalDay } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'

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
  if ((await checkBannedWords(content)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }

  const moderationStatus = body?.moderationStatus === 'REJECTED' ? 'REJECTED' : 'APPROVED'
  const sort = Number(body?.sort) || 0
  const today = startOfLocalDay()
  const ipLocation = await resolveIpLocation(request)
  const ipRegion = ipLocation?.label || null
  void updateUserIpRegion(guard.user.id, ipLocation)

  try {
    const created = await prisma.dailyMessage.create({
      data: {
        userId: guard.user.id,
        date: today,
        content,
        ipRegion,
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
