import { NextResponse } from 'next/server'
import { getUnreadNotificationCount } from '@/lib/notifications'
import { requireUser } from '@/lib/security'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const count = await getUnreadNotificationCount(guard.user.id)
  return NextResponse.json({ count })
}
