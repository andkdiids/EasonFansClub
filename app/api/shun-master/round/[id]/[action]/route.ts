import { NextResponse } from 'next/server'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'
import { ShunError, shunSendNotification } from '@/lib/shun-master'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, findMatchedBannedWords, getEnabledBannedWords } from '@/lib/content-moderation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Completes the notification step of one already-settled take.
 *
 * `notify` sends the ordinary "your fee was taken" notice; `letter` stores the
 * anonymous letter and sends the letter notice instead. Both are scoped to the
 * original actor and idempotent: once either one has been delivered the other
 * can never create a second notification.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { id, action } = await params
  if (!/^[a-z0-9]{1,40}$/.test(id) || (action !== 'notify' && action !== 'letter')) {
    return json({ message: '未找到操作。' }, 404)
  }
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'shun-master:notify', user: { limit: 30, windowSeconds: 60 }, ip: { limit: 150, windowSeconds: 60 },
  })
  if (limited) return limited
  try {
    if (action === 'notify') return json(await shunSendNotification(guard.user.id, id, null))
    const body = await request.json().catch(() => null)
    if (typeof body?.message !== 'string') return json({ message: '留言内容无效。', code: 'LETTER_INVALID' }, 400)
    // Same content-safety rules as every other user-authored surface.
    if (findMatchedBannedWords(body.message, await getEnabledBannedWords()).length) {
      return json({ code: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, 400)
    }
    return json(await shunSendNotification(guard.user.id, id, body.message))
  } catch (error) {
    if (error instanceof ShunError) return json({ code: error.code, message: error.message }, error.status)
    return json({ message: '目前无法完成通知发送，请稍后重试。' }, 500)
  }
}
