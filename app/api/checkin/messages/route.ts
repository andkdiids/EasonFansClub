import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { formatBeijingDate, parseBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessagesPage, type CheckInMessageSort } from '@/lib/checkin-messages'
import { withDbTimeout } from '@/lib/db-timeout'
import { getFriendIds } from '@/lib/friends'

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
  const scope = url.searchParams.get('scope') === 'friends' ? 'friends' : 'public'
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)

  try {
    const friendIds = scope === 'friends'
      ? await withDbTimeout('Friendship.findMany checkin.messages.api', getFriendIds(user.id))
      : undefined
    const messagePage = await withDbTimeout(
      'DailyMessage.page checkin.messages.api',
      getCheckInMessagesPage({
        selectedDate,
        nextDate,
        sort,
        viewerId: user.id,
        viewerCanModerate: user.role === 'ADMIN' || user.role === 'SUPER_ADMIN',
        userIds: friendIds,
        stickyUserId: scope === 'friends' ? user.id : undefined,
        page,
      }),
    )

    return NextResponse.json(
      {
        date: formatBeijingDate(selectedDate),
        sort,
        scope,
        messages: messagePage.messages,
        pagination: messagePage.pagination,
        ...messagePage.pagination,
      },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } },
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
        scope,
      },
      error,
    )
    return NextResponse.json({ message: '留言列表暂时无法加载，请稍后重试' }, { status: 503 })
  }
}
