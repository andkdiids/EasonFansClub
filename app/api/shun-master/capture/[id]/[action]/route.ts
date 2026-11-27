import { NextResponse } from 'next/server'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'
import { settleShunRevenge, retryShunCapture, ShunError, shunCapture } from '@/lib/shun-master'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { id, action } = await params
  if (!/^[a-z0-9]{1,40}$/.test(id) || (action !== 'start' && action !== 'guess' && action !== 'retry-item' && action !== 'revenge-item')) return json({ message: '未找到操作。' }, 404)
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'shun-master:capture', user: { limit: 25, windowSeconds: 60 }, ip: { limit: 150, windowSeconds: 60 },
  })
  if (limited) return limited
  try {
    if (action === 'revenge-item') return json(await settleShunRevenge(guard.user.id, id))
    if (action === 'retry-item') return json(await retryShunCapture(guard.user.id, id))
    if (action === 'start') return json(await shunCapture(guard.user.id, id))
    const body = await request.json().catch(() => null)
    if ((body?.mode !== 2 && body?.mode !== 3 && body?.mode !== 4) || !Number.isSafeInteger(body.uid) || body.uid <= 0) {
      return json({ message: '请选择一位候选人。' }, 400)
    }
    return json(await shunCapture(guard.user.id, id, { uid: body.uid, mode: body.mode }))
  } catch (error) {
    if (error instanceof ShunError) return json({ code: error.code, message: error.message }, error.status)
    return json({ message: '目前无法完成抓捕，请稍后重试。' }, 500)
  }
}
