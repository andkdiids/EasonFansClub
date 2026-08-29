import { NextResponse } from 'next/server'
import { formatBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { CHECK_IN_MESSAGE_MAX_LENGTH } from '@/lib/checkin-message-constants'
import { CheckInMessageSupplementError, supplementTodayCheckInMessage } from '@/lib/checkin-message-supplement'
import { getCheckInMessage, invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { checkBannedWords, CONTENT_CONTAINS_BANNED_WORD, BANNED_WORD_MESSAGE } from '@/lib/content-moderation'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/checkin/message:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
  })
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const rawMessage = body?.message
  if (typeof rawMessage !== 'string' || rawMessage.length > CHECK_IN_MESSAGE_MAX_LENGTH || !rawMessage.trim()) {
    return NextResponse.json({ ok: false, code: 'INVALID_MESSAGE', message: '留言不能为空且最多 300 字' }, { status: 400 })
  }

  const message = sanitizeText(rawMessage, CHECK_IN_MESSAGE_MAX_LENGTH)
  if (!message) {
    return NextResponse.json({ ok: false, code: 'INVALID_MESSAGE', message: '留言不能为空且最多 300 字' }, { status: 400 })
  }
  if ((await checkBannedWords(message)).blocked) {
    return NextResponse.json({ ok: false, error: CONTENT_CONTAINS_BANNED_WORD, code: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }

  const now = new Date()
  try {
    const result = await prisma.$transaction((tx) => supplementTodayCheckInMessage(tx, {
      userId: guard.user.id,
      message,
      now,
    }))

    invalidateCheckInMessagesCache()
    invalidateHomeDataCache()
    const today = startOfLocalDay(now)
    const dailyMessage = await getCheckInMessage({
      messageId: result.dailyMessageId,
      selectedDate: today,
      nextDate: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      viewerId: guard.user.id,
      viewerCanModerate: guard.user.role === 'ADMIN' || guard.user.role === 'SUPER_ADMIN',
    }).catch(() => null)

    return NextResponse.json({
      ok: true,
      code: 'MESSAGE_SUPPLEMENTED',
      message: '留言已补写',
      checkDate: formatBeijingDate(now),
      todayCheckIn: result.checkIn,
      dailyMessageId: result.dailyMessageId,
      dailyMessage,
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
    })
  } catch (error) {
    if (error instanceof CheckInMessageSupplementError) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    }

    console.error('[checkin:message-supplement]', { userId: guard.user.id, error })
    return NextResponse.json({ ok: false, code: 'MESSAGE_SUPPLEMENT_FAILED', message: '留言补写失败，请稍后重试' }, { status: 500 })
  }
}
