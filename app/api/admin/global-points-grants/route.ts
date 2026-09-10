import { NextResponse } from 'next/server'
import {
  createGlobalPointsGrant,
  getGlobalPointsGrantDetail,
  getGlobalPointsGrantOverview,
  getGlobalPointsGrantRecipientPreview,
  GlobalPointsGrantError,
  processGlobalPointsGrantBatch,
} from '@/lib/global-points-grant'
import { GLOBAL_POINTS_GRANT_PERMISSION } from '@/lib/global-points-grant-constants'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function jsonError(message: string, status = 400, code = 'INVALID_INPUT') {
  return NextResponse.json({ code, message }, { status, headers: privateHeaders })
}

function bodyRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function GET(request: Request) {
  const guard = await requireAdmin(GLOBAL_POINTS_GRANT_PERMISSION)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/global-points-grants:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  try {
    const id = new URL(request.url).searchParams.get('id')?.trim()
    const result = id ? await getGlobalPointsGrantDetail(id) : await getGlobalPointsGrantOverview()
    return NextResponse.json(result, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof GlobalPointsGrantError) return jsonError(error.message, error.status, error.code)
    console.error('[admin.global-points-grant.get]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return jsonError('发放记录加载失败，请稍后重试', 500, 'GLOBAL_POINTS_GRANT_READ_FAILED')
  }
}

export async function POST(request: Request) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin(GLOBAL_POINTS_GRANT_PERMISSION)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/global-points-grants:POST',
    ip: { limit: 12, windowSeconds: 60 },
    user: { limit: 8, windowSeconds: 60 },
  }, '全站发放操作过于频繁，请稍后再试')
  if (limited) return limited

  const input = bodyRecord(await request.json().catch(() => null))
  if ('recipientIds' in input || 'userIds' in input) return jsonError('收件人必须由服务端根据有效用户规则确定', 400, 'RECIPIENTS_SERVER_RESOLVED')

  try {
    const action = typeof input.action === 'string' ? input.action : 'send'
    if (action === 'preview') {
      const rawAmount = typeof input.amount === 'number' || typeof input.amount === 'string' ? input.amount : ''
      const amount = Number(rawAmount)
      return NextResponse.json(await getGlobalPointsGrantRecipientPreview(amount), { headers: privateHeaders })
    }
    if (action === 'retry') {
      const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
      if (!batchId) return jsonError('发放批次不存在', 404, 'BATCH_NOT_FOUND')
      const batch = await processGlobalPointsGrantBatch(batchId, guard.user.id, { retryFailed: true })
      return NextResponse.json({ ok: true, batch, message: '失败项目已加入后台重试队列，页面可以关闭' }, { status: 202, headers: privateHeaders })
    }
    if (action === 'continue') {
      const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
      if (!batchId) return jsonError('发放批次不存在', 404, 'BATCH_NOT_FOUND')
      const batch = await processGlobalPointsGrantBatch(batchId, guard.user.id)
      return NextResponse.json({ ok: true, batch, message: '批次已加入后台处理队列，页面可以关闭' }, { status: 202, headers: privateHeaders })
    }

    const result = await createGlobalPointsGrant({
      operatorId: guard.user.id,
      title: input.title,
      content: input.content,
      amount: input.amount,
      imageUrl: input.imageUrl,
      idempotencyKey: input.idempotencyKey,
      confirm: input.confirm === true,
      confirmationText: input.confirmationText,
    })
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      batch: result.batch,
      message: result.duplicate
        ? '该发放批次已存在，未重复到账'
        : `全站挂号费发放已开始，批次 ${result.batch.id} 已加入后台处理队列，页面可以关闭`,
    }, { status: result.duplicate ? 200 : 202, headers: privateHeaders })
  } catch (error) {
    if (error instanceof GlobalPointsGrantError) return jsonError(error.message, error.status, error.code)
    console.error('[admin.global-points-grant.send]', { operatorId: guard.user.id, errorName: error instanceof Error ? error.name : 'UnknownError' })
    return jsonError('全站挂号费发放失败，请查看记录后重试', 500, 'GLOBAL_POINTS_GRANT_FAILED')
  }
}
