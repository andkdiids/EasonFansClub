import { NextResponse } from 'next/server'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { ShunError, shunAttempt, shunJoin, shunRecords, shunStatus } from '@/lib/shun-master'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ action: string }> }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { action } = await params
  try {
    if (action === 'status' || action === 'config') {
      const status = await shunStatus(guard.user.id)
      if (action === 'status') return json(status)
      const { enabled, attempts, victimCap, goldenMinutes } = status
      return json({ enabled, attempts, victimCap, goldenMinutes, maxAmount: 7 })
    }
    if (action === 'records') {
      const query = new URL(request.url).searchParams
      const side = query.get('side')
      const cursor = query.get('cursor')
      const focus = query.get('record')
      if ((side !== 'in' && side !== 'out') || [cursor, focus].some((id) => id && !/^[a-z0-9]{1,40}$/.test(id))) {
        return json({ message: '查询参数无效。' }, 400)
      }
      return json(await shunRecords(guard.user.id, side, cursor || undefined, focus || undefined))
    }
    return json({ message: '未找到操作。' }, 404)
  } catch (error) { return handleShunError(error) }
}

export async function POST(request: Request, { params }: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { action } = await params
  if (action !== 'attempt' && action !== 'membership') return json({ message: '未找到操作。' }, 404)
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'shun-master:' + action, user: { limit: 18, windowSeconds: 60 }, ip: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited
  const body = await request.json().catch(() => null)
  try {
    if (action === 'attempt' && typeof body?.requestId === 'string'
      && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.requestId)) {
      return json(await shunAttempt(guard.user.id, body.requestId))
    }
    if (action === 'membership' && typeof body?.joined === 'boolean') {
      const version = Number.isSafeInteger(body.acceptedRulesVersion) ? body.acceptedRulesVersion : undefined
      return json(await shunJoin(guard.user.id, body.joined, version))
    }
    return json({ message: '请求参数无效。' }, 400)
  } catch (error) { return handleShunError(error) }
}

function handleShunError(error: unknown) {
  if (error instanceof ShunError) return json({ code: error.code, message: error.message }, error.status)
  return json({ message: '目前无法完成操作，请稍后重试。' }, 500)
}
