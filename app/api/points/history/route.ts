import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getRegistrationFeeHistory, REGISTRATION_FEE_HISTORY_PAGE_SIZE } from '@/lib/registration-fee'

export const dynamic = 'force-dynamic'

const privateNoStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后查看挂号费记录' }, { status: 401, headers: privateNoStoreHeaders })

  const { searchParams } = new URL(request.url)
  const data = await getRegistrationFeeHistory(user.id, {
    page: Number(searchParams.get('page') || 1),
    pageSize: Math.min(Number(searchParams.get('pageSize') || REGISTRATION_FEE_HISTORY_PAGE_SIZE), 50),
  })
  return NextResponse.json({ ok: true, data }, { headers: privateNoStoreHeaders })
}
