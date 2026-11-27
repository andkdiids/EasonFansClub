import { NextResponse } from 'next/server'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'
import { sendShunItemGift, shunItemBox, ShunError, shunAttempt, shunPermanentOptOut, shunRecords, shunStatus, useShunExtraAttempt } from '@/lib/shun-master'
import { RegistrationFeeHistoryQueryError } from '@/lib/registration-fee'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ action: string }> }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request, { params }: Context) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { action } = await params
  try {
    if (action === 'status' || action === 'config') {
      const status = await shunStatus(guard.user.id)
      if (action === 'status') return json(status)
      const { enabled, attempts, victimCap, goldenMinutes } = status
      return json({ enabled, attempts, victimCap, goldenMinutes, maxAmount: 7 })
    }
    if (action === 'items') return json(await shunItemBox(guard.user.id))
    if (action === 'records') {
      const query = new URL(request.url).searchParams
      const side = query.get('side')
      const cursor = query.get('cursor')
      const focus = query.get('record')
      if ((side !== 'in' && side !== 'out') || [cursor, focus].some((id) => id && !/^[a-z0-9]{1,40}$/.test(id))) {
        return json({ message: '查询参数无效。' }, 400)
      }
      const range = query.get('range') || 'all'
      if (range !== 'all' && range !== 'today' && range !== 'yesterday' && range !== 'week' && range !== 'date') {
        return json({ message: '日期范围无效。' }, 400)
      }
      const windowAt = cursor ? query.get('windowAt') : null
      const now = windowAt ? new Date(windowAt) : undefined
      if (now && (!Number.isFinite(now.getTime()) || now.getTime() > Date.now())) {
        return json({ message: '分页日期无效。' }, 400)
      }
      return json(await shunRecords(guard.user.id, side, cursor || undefined, focus || undefined,
        { range, dateKey: query.get('dateKey') || undefined, now }))
    }
    return json({ message: '未找到操作。' }, 404)
  } catch (error) { return handleShunError(error) }
}

export async function POST(request: Request, { params }: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { action } = await params
  if (action !== 'attempt' && action !== 'opt-out' && action !== 'extra-attempt' && action !== 'gift') return json({ message: '未找到操作。' }, 404)
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'shun-master:' + action, user: { limit: 18, windowSeconds: 60 }, ip: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited
  // Irreversible: no body, no rejoin counterpart. Repeated calls are absorbed
  // by the idempotent service and always return the current durable state.
  if (action === 'opt-out') return json(await shunPermanentOptOut(guard.user.id))
  const body = await request.json().catch(() => null)
  try {
    if ((action === 'attempt' || action === 'extra-attempt' || action === 'gift') && typeof body?.requestId === 'string'
      && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.requestId)) {
      if (action === 'gift') {
        if (typeof body.friendId !== 'string' || !/^[a-z0-9]{1,40}$/.test(body.friendId)) {
          return json({ message: '请求参数无效。' }, 400)
        }
        return json(await sendShunItemGift(guard.user.id, body.friendId, body.requestId))
      }
      if (action === 'extra-attempt') return json(await useShunExtraAttempt(guard.user.id, body.requestId))
      // The take is settled here and now; the optional letter is a separate,
      // later decision (`POST /api/shun-master/round/<id>/letter`).
      return json(await shunAttempt(guard.user.id, body.requestId))
    }
    return json({ message: '请求参数无效。' }, 400)
  } catch (error) { return handleShunError(error) }
}

function handleShunError(error: unknown) {
  if (error instanceof RegistrationFeeHistoryQueryError) return json({ message: '请选择有效日期。' }, 400)
  if (error instanceof ShunError) {
    // `details` is additive: existing clients keep reading `code` + `message`,
    // while the page can render the live window and the next opening instant
    // from the rejection itself even if its status snapshot is stale.
    return json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, error.status)
  }
  return json({ message: '目前无法完成操作，请稍后重试。' }, 500)
}
