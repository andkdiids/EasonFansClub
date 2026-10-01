import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedCosObjectUrl } from '@/lib/tencent-cos'
import { safeReviewIdentifier } from '@/lib/cantonese-review'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
type RouteContext = { params: Promise<{ audioId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  const { audioId: rawAudioId } = await context.params
  const audioId = safeReviewIdentifier(rawAudioId)
  if (!audioId) return NextResponse.json({ ok: false, code: 'INVALID_AUDIO_ID' }, { status: 400, headers: NO_STORE })

  const asset = await prisma.cantoneseAudioAsset.findUnique({
    where: { externalId: audioId },
    select: { cosKey: true, assetStatus: true, status: true },
  })
  if (!asset) return NextResponse.json({ ok: false, code: 'AUDIO_NOT_FOUND' }, { status: 404, headers: NO_STORE })
  if (!asset.cosKey || asset.assetStatus !== 'READY') return NextResponse.json({ ok: false, code: 'AUDIO_NOT_READY' }, { status: 409, headers: NO_STORE })

  try {
    const audioUrl = getSignedCosObjectUrl(asset.cosKey, 180)
    return NextResponse.json({ audioUrl, expiresInSeconds: 180 }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'AUDIO_PREVIEW_UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }
}
