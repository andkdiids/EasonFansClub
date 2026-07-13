import { NextResponse } from 'next/server'
import { markAllUnifiedNotificationsRead } from '@/lib/notifications'
import { requireUser } from '@/lib/security'

export async function POST() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  await markAllUnifiedNotificationsRead(guard.user.id)
  return NextResponse.json({ ok: true })
}
