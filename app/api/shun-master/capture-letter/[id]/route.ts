import { NextResponse } from 'next/server'
import { enforceApiRateLimit, requireRequestUser } from '@/lib/security'
import { readCaptureLetter } from '@/lib/shun-capture-letter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Recipient-only read endpoint for one capture counter note.
 *
 * `id` accepts either the note id or the Shun round id, so a notification link
 * can carry the round without leaking an extra identifier. Every rejection path
 * returns the same 404 body, and the projection only ever contains the
 * capturer's public identity (nickname, avatar, uid) — never a database id,
 * email or phone.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { id } = await params
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'shun-master:capture-letter', user: { limit: 30, windowSeconds: 60 }, ip: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited
  const letter = await readCaptureLetter(guard.user.id, id)
  if (!letter) {
    return NextResponse.json({ message: '未找到这封信。' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  }
  return NextResponse.json(letter, { headers: { 'Cache-Control': 'private, no-store' } })
}
