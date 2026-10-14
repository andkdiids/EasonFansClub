import { NextResponse } from 'next/server'
import { requireRequestAdmin } from '@/lib/security'
import { listCantoneseSeedPacks } from '@/lib/cantonese-seed-pack-preview'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const packs = await listCantoneseSeedPacks()
  return NextResponse.json({ packs }, { headers: NO_STORE })
}
