import { NextResponse } from 'next/server'
import { listPopupSystemNotifications } from '@/lib/notifications'
import { requireUser } from '@/lib/security'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const notifications = await listPopupSystemNotifications(guard.user.id, 5)
  return NextResponse.json({ notifications })
}
