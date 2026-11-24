import { NextResponse } from 'next/server'
import { enforceApiRateLimit, requireRequestUser } from '@/lib/security'
import { readAnonymousLetter } from '@/lib/shun-anonymous-letter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Recipient-only read endpoint for one anonymous letter.
 *
 * `id` accepts either the letter id or the Shun round id, so a notification link
 * can carry the round without leaking an extra identifier. Every rejection path
 * returns the same 404 body: an unknown letter, a hidden letter, a letter owned
 * by another account and a forged id are indistinguishable, and the projection
 * never contains the sender.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { id } = await params
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: 'shun-master:letter', user: { limit: 30, windowSeconds: 60 }, ip: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited
  const letter = await readAnonymousLetter(guard.user.id, id)
  if (!letter) {
    return NextResponse.json({ message: '未找到这封信。' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  }
  return NextResponse.json(letter, { headers: { 'Cache-Control': 'private, no-store' } })
}
