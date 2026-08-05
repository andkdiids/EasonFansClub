import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getTodayMonthDay } from '@/lib/today'
import { getTodayEventRecords } from '@/lib/today-events'
import { TodayPageClient, type TodayEventView } from './TodayPageClient'

export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Ftoday')
  const { month, day } = getTodayMonthDay()
  const initialEvents: TodayEventView[] = await getTodayEventRecords()
  return <TodayPageClient month={month} day={day} initialEvents={initialEvents} />
}
