import { NextResponse } from 'next/server'
import { markModerationNotificationsRead } from '@/lib/notifications'
import { emitRealtime } from '@/lib/realtime'
import { requireUser } from '@/lib/security'

export async function POST() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const result = await markModerationNotificationsRead(guard.user.id)
  if (result.count > 0) emitRealtime(guard.user.id, 'notification')
  return NextResponse.json(result)
}
