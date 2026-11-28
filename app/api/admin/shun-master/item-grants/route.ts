import { NextResponse } from 'next/server'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import {
  cancelShunItemGrantTask, createShunItemGrantTask, listShunItemGrants, retryFailedShunItemGrants,
  shunItemGrantDetail, shunItemGrantPreview, ShunItemGrantError, SHUN_ITEM_GRANT_PERMISSION,
} from '@/lib/shun-item-grants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const json = (data: unknown, status = 200) => NextResponse.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store' },
})

function handle(error: unknown) {
  if (error instanceof ShunItemGrantError) return json({ code: error.code, message: error.message }, error.status)
  return json({ message: '发放操作失败，请稍后重试。' }, 500)
}

export async function GET(request: Request) {
  const guard = await requireAdmin(SHUN_ITEM_GRANT_PERMISSION)
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const taskId = params.get('taskId')?.trim()
  if (taskId && !/^[a-z0-9]{1,40}$/.test(taskId)) return json({ message: '任务 ID 无效。' }, 400)
  try {
    const [preview, list] = await Promise.all([shunItemGrantPreview(), listShunItemGrants()])
    const detail = taskId ? await shunItemGrantDetail(taskId) : null
    return json({ ...preview, ...list, detail })
  } catch (error) {
    return handle(error)
  }
}

export async function POST(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin(SHUN_ITEM_GRANT_PERMISSION)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'admin:shun-item-grant', user: { limit: 6, windowSeconds: 60 }, ip: { limit: 30, windowSeconds: 60 },
  })
  if (limited) return limited
  const body = await request.json().catch(() => null)
  try {
    return json(await createShunItemGrantTask(guard.user.id, body))
  } catch (error) {
    return handle(error)
  }
}

export async function PATCH(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin(SHUN_ITEM_GRANT_PERMISSION)
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : ''
  if (!/^[a-z0-9]{1,40}$/.test(taskId)) return json({ message: '任务 ID 无效。' }, 400)
  try {
    if (body?.action === 'cancel') return json({ task: await cancelShunItemGrantTask(guard.user.id, taskId) })
    if (body?.action === 'retry') return json(await retryFailedShunItemGrants(guard.user.id, taskId))
    return json({ message: '未找到操作。' }, 404)
  } catch (error) {
    return handle(error)
  }
}
