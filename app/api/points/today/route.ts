import { NextResponse } from 'next/server'
import { getTodayRegistrationFeeSummary } from '@/lib/registration-fee'
import { requireRequestUser, unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateNoStoreHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  const user = guard.user
  if (!user) {
    if (guard.response.status !== 401) return guard.response
    return unauthenticatedResponse('请先登录后查看挂号费记录', privateNoStoreHeaders, { data: null, error: '请先登录后查看挂号费记录' })
  }

  try {
    const data = await getTodayRegistrationFeeSummary(user.id)
    return NextResponse.json({ ok: true, data, error: null }, { headers: privateNoStoreHeaders })
  } catch {
    return NextResponse.json(
      { ok: false, data: null, error: '获取挂号费记录失败' },
      { status: 500, headers: privateNoStoreHeaders },
    )
  }
}
