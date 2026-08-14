import { NextResponse } from 'next/server'
import { markAllUnifiedNotificationsRead } from '@/lib/notifications'
import { emitRealtime } from '@/lib/realtime'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  await markAllUnifiedNotificationsRead(guard.user.id)
  emitRealtime(guard.user.id, 'notification')
  return NextResponse.json({ ok: true }, { headers: privateHeaders })
}
