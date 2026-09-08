import { NextResponse } from 'next/server'
import { enforceApiRateLimit, requireAdmin, sanitizeText } from '@/lib/security'
import {
  getHighRiskUsers,
  getTodayUserOperations,
  getUserOperationTimeline,
  normalizeUserOperationCategory,
  searchUserOperationUsers,
  type UserOperationView,
} from '@/lib/user-operation-center'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function parseView(value: string | null): UserOperationView {
  return value === 'risk' || value === 'timeline' || value === 'users' ? value : 'today'
}

function parsePage(value: string | null, fallback: number, max = 10_000) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback
}

export async function GET(request: Request) {
  const guard = await requireAdmin('user_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/user-operations',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const params = new URL(request.url).searchParams
  const view = parseView(params.get('view'))
  const query = sanitizeText(params.get('q'), 80).trim()
  const category = normalizeUserOperationCategory(params.get('category'))
  const page = parsePage(params.get('page'), 1)
  const pageSize = Math.min(50, parsePage(params.get('pageSize'), 30, 50))
  const days = Math.min(365, parsePage(params.get('days'), view === 'risk' ? 90 : 30, 365))

  if (view === 'users') {
    return NextResponse.json({ users: await searchUserOperationUsers(query) }, { headers: privateHeaders })
  }
  if (view === 'timeline') {
    const userId = sanitizeText(params.get('userId'), 191).trim()
    if (!userId) return NextResponse.json({ message: '用户不能为空', code: 'USER_REQUIRED' }, { status: 400, headers: privateHeaders })
    const result = await getUserOperationTimeline({ userId, category, days, page, pageSize })
    if (!result) return NextResponse.json({ message: '用户不存在', code: 'USER_NOT_FOUND' }, { status: 404, headers: privateHeaders })
    return NextResponse.json(result, { headers: privateHeaders })
  }
  if (view === 'risk') {
    return NextResponse.json(await getHighRiskUsers({ query, days, page, pageSize }), { headers: privateHeaders })
  }
  return NextResponse.json(await getTodayUserOperations({ query, category, page, pageSize }), { headers: privateHeaders })
}
