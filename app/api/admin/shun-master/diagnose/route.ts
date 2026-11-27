import { NextResponse } from 'next/server'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { diagnoseShunTarget, ShunError } from '@/lib/shun-master'

export const dynamic = 'force-dynamic'

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })

/**
 * Admin-only, read-only shun candidacy diagnosis.
 *
 * `GET /api/admin/shun-master/diagnose?uid=2&actorUid=1`
 *
 * Answers, from live data: is this account eligible to be shun'ed right now,
 * which exclusion applies if not, how often it has been taken, and — when an
 * actor UID is supplied — whether the pair is really friends and how large the
 * actor's usable friend pool is. Booleans and enum reasons only; no PII.
 */
export async function GET(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/shun-master/diagnose:GET',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  })
  if (limited) return limited

  const url = new URL(request.url)
  const uid = Number(url.searchParams.get('uid'))
  const actorUidRaw = url.searchParams.get('actorUid')
  const actorUid = actorUidRaw ? Number(actorUidRaw) : undefined
  if (!Number.isInteger(uid) || uid <= 0) {
    return json({ ok: false, message: '请输入有效的 UID。' }, 400)
  }
  if (actorUidRaw !== null && actorUidRaw !== undefined && (!Number.isInteger(actorUid) || (actorUid ?? 0) <= 0)) {
    return json({ ok: false, message: '发起人 UID 无效。' }, 400)
  }
  try {
    const result = await diagnoseShunTarget(uid, actorUid)
    return json({ ok: true, diagnosis: result })
  } catch (error) {
    if (error instanceof ShunError) return json({ ok: false, message: error.message }, error.status)
    console.error('[shun-diagnose]', error)
    return json({ ok: false, message: '诊断查询失败，请稍后再试。' }, 500)
  }
}
