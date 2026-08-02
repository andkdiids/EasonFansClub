import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getTodayRegistrationFeeSummary } from '@/lib/registration-fee'

export const dynamic = 'force-dynamic'

const privateNoStoreHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { ok: false, data: null, error: '请先登录后查看挂号费记录' },
      { status: 401, headers: privateNoStoreHeaders },
    )
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
