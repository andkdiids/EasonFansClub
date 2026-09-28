import { NextResponse } from 'next/server'
import { currentMobileHomeHeroImage } from '@/lib/mobile-home-hero'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Public read-only projection of the existing admin-managed site.appearance Hero. */
export async function GET() {
  const appearance = await getSiteAppearance({ cache: 'no-store' })
  return NextResponse.json(
    { imageUrl: currentMobileHomeHeroImage(appearance) },
    { headers: { 'Cache-Control': 'public, no-store, max-age=0' } },
  )
}
