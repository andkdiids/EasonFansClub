import { NextResponse } from 'next/server'
import { requireRequestUser } from '@/lib/security'
import { FoundationAudioUnavailable, isFoundationAudioId, resolveFoundationAudioUrl } from '@/lib/cantonese-foundation-audio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ audioId: string }> }
const noStore = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request, { params }: Context) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { audioId } = await params
  if (!isFoundationAudioId(audioId)) {
    return NextResponse.json({ ok: false, code: 'AUDIO_NOT_FOUND' }, { status: 404, headers: noStore })
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
