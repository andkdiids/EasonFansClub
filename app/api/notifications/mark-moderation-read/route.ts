import { NextResponse } from 'next/server'
import { markModerationNotificationsRead } from '@/lib/notifications'
import { requireUser } from '@/lib/security'

export async function POST() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const result = await markModerationNotificationsRead(guard.user.id)
  return NextResponse.json(result)
}
