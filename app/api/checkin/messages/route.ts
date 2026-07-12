import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { formatBeijingDate, parseBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessages, type CheckInMessageSort } from '@/lib/checkin-messages'
import { withDbTimeout } from '@/lib/db-timeout'

export const dynamic = 'force-dynamic'

function parseRequestedDate(value: string | null) {
  const today = startOfLocalDay()
  if (!value) return today

  const date = parseBeijingDate(value)
  const yearAgo = new Date(today)
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1)

  if (!date || date > today || date < yearAgo) return today
  return date
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ message: '请先登录' }, { status: 401 })
  }

  const url = new URL(request.url)
  const selectedDate = parseRequestedDate(url.searchParams.get('date'))
  const nextDate = new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000)
  const sort: CheckInMessageSort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'latest'

  try {
    const messages = await withDbTimeout(
      'DailyMessage.findMany checkin.messages.api',
      getCheckInMessages({
        selectedDate,
        nextDate,
        sort,
        viewerId: user.id,
      }),
    )

    return NextResponse.json(
      { date: formatBeijingDate(selectedDate), sort, messages },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error(
      '[checkin:messages] prisma query failed',
      {
        model: 'DailyMessage',
        query: 'findMany',
        feature: 'checkin.messages.api',
        date: formatBeijingDate(selectedDate),
        sort,
      },
      error,
    )
    return NextResponse.json({ message: '留言列表暂时无法加载，请稍后重试' }, { status: 503 })
  }
}
