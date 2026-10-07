import { NextResponse } from 'next/server'
import { requireRequestUser } from '@/lib/security'
import { buildCantoneseProgressResponse, loadCantoneseProgressContext } from '@/lib/cantonese-progress'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  try {
    const context = await loadCantoneseProgressContext(guard.user.id)
    return NextResponse.json(buildCantoneseProgressResponse(context), { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'PROGRESS_UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }
}
