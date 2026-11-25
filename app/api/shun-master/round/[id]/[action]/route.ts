import { NextResponse } from 'next/server'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'
import { ShunError, shunSendCaptureNotification, shunSendNotification } from '@/lib/shun-master'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, findMatchedBannedWords, getEnabledBannedWords } from '@/lib/content-moderation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Completes the notification step of one already-settled round.
 *
 * Take flow (the actor decides about the anonymous letter):
 * - `notify`  → the ordinary "your fee was taken" notice
 * - `letter`  → stores the anonymous letter and sends the letter notice instead
 *
 * Capture flow (the capturer decides about the counter note):
 * - `captured`       → the ordinary "you have been arrested" notice
 * - `capture-letter` → stores the signed counter note and sends the letter notice
 *
 * Every action is scoped to the account that owns the decision and idempotent:
 * once either branch has been delivered the other can never create a second
 * notification, and a note can never be appended to an already-notified round.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { id, action } = await params
  const take = action === 'notify' || action === 'letter'
  const capture = action === 'captured' || action === 'capture-letter'
  if (!/^[a-z0-9]{1,40}$/.test(id) || (!take && !capture)) {
    return json({ message: '未找到操作。' }, 404)
  }
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'shun-master:notify', user: { limit: 30, windowSeconds: 60 }, ip: { limit: 150, windowSeconds: 60 },
  })
  if (limited) return limited
  try {
    // Plain branches carry no body and no user-authored content.
    if (action === 'notify') return json(await shunSendNotification(guard.user.id, id, null))
    if (action === 'captured') return json(await shunSendCaptureNotification(guard.user.id, id, null))
    const body = await request.json().catch(() => null)
    if (typeof body?.message !== 'string') return json({ message: '留言内容无效。', code: 'LETTER_INVALID' }, 400)
    // Same content-safety rules as every other user-authored surface.
    if (findMatchedBannedWords(body.message, await getEnabledBannedWords()).length) {
      return json({ code: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, 400)
    }
    return json(capture
      ? await shunSendCaptureNotification(guard.user.id, id, body.message)
      : await shunSendNotification(guard.user.id, id, body.message))
  } catch (error) {
    if (error instanceof ShunError) return json({ code: error.code, message: error.message }, error.status)
    return json({ message: '目前无法完成通知发送，请稍后重试。' }, 500)
  }
}
