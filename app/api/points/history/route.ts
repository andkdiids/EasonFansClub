import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getRegistrationFeeHistory,
  REGISTRATION_FEE_HISTORY_PAGE_SIZE,
  type RegistrationFeeHistoryRange,
  RegistrationFeeHistoryQueryError,
} from '@/lib/registration-fee'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateNoStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }
const registrationFeeHistoryRanges = new Set<RegistrationFeeHistoryRange>(['all', 'today', 'yesterday', 'week', 'date'])

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录后查看挂号费记录', privateNoStoreHeaders)

  const { searchParams } = new URL(request.url)
  const rawRange = searchParams.get('range') || 'all'
  if (!registrationFeeHistoryRanges.has(rawRange as RegistrationFeeHistoryRange)) {
    return NextResponse.json({ ok: false, message: '挂号费记录筛选条件无效' }, { status: 400, headers: privateNoStoreHeaders })
  }

  try {
    const data = await getRegistrationFeeHistory(user.id, {
      page: Number(searchParams.get('page') || 1),
      pageSize: Math.min(Number(searchParams.get('pageSize') || REGISTRATION_FEE_HISTORY_PAGE_SIZE), 50),
      range: rawRange as RegistrationFeeHistoryRange,
      dateKey: searchParams.get('date') || undefined,
    })
    return NextResponse.json({ ok: true, data }, { headers: privateNoStoreHeaders })
  } catch (error) {
    if (error instanceof RegistrationFeeHistoryQueryError) {
      return NextResponse.json({ ok: false, message: '挂号费记录日期无效' }, { status: 400, headers: privateNoStoreHeaders })
    }
    throw error
  }
}
