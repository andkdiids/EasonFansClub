import { NextResponse } from 'next/server'
import { getAdminPharmacyBadges } from '@/lib/pharmacy'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const badges = await getAdminPharmacyBadges(new URL(request.url).searchParams.get('q'))
  return NextResponse.json({ ok: true, badges }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

