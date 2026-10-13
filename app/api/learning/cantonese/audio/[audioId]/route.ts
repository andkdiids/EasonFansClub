import { NextResponse } from 'next/server'
import { requireRequestUser } from '@/lib/security'
import { FoundationAudioUnavailable, isFoundationAudioId, resolveFoundationAudioUrl } from '@/lib/cantonese-foundation-audio'
import { prisma } from '@/lib/prisma'
import { getSignedCosObjectUrl } from '@/lib/tencent-cos'
import { safeReviewIdentifier } from '@/lib/cantonese-review'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ audioId: string }> }
const noStore = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request, { params }: Context) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { audioId } = await params
  if (!safeReviewIdentifier(audioId)) {
    return NextResponse.json({ ok: false, code: 'AUDIO_NOT_FOUND' }, { status: 404, headers: noStore })
  }

  if (!isFoundationAudioId(audioId)) {
    const asset = await prisma.cantoneseAudioAsset.findUnique({
      where: { externalId: audioId },
      select: { cosKey: true, assetStatus: true, status: true, audioKey: true, audioVersion: true, checksum: true, fileSize: true },
    })
    if (!asset || asset.status !== 'APPROVED' || asset.assetStatus !== 'READY' || !asset.cosKey || !asset.checksum || !asset.fileSize) {
      return NextResponse.json({ ok: false, code: 'AUDIO_NOT_FOUND' }, { status: 404, headers: noStore })
    }
    try {
      return NextResponse.json({
        audioUrl: getSignedCosObjectUrl(asset.cosKey, 180),
        audioKey: asset.audioKey ?? createHash('sha256').update(asset.cosKey).digest('hex'), audioVersion: asset.audioVersion,
        checksum: asset.checksum, fileSize: asset.fileSize,
      }, { headers: noStore })
    } catch {
      return NextResponse.json({ ok: false, code: 'AUDIO_UNAVAILABLE' }, { status: 503, headers: noStore })
    }
  }

  try {
    const audioUrl = await resolveFoundationAudioUrl(audioId)
    if (!audioUrl) {
      return NextResponse.json({ ok: false, code: 'AUDIO_NOT_FOUND' }, { status: 404, headers: noStore })
    }
    return NextResponse.json({ audioUrl }, { headers: noStore })
  } catch (error) {
    console.warn('[cantonese.foundation.audio]', {
      audioId,
      code: error instanceof FoundationAudioUnavailable ? error.code : 'UNKNOWN',
    })
    return NextResponse.json({ ok: false, code: 'AUDIO_UNAVAILABLE', message: '音频暂不可用，请稍后重试' },
      { status: 503, headers: noStore })
  }
}
