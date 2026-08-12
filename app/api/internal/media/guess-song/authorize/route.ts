import { getGuessSongPlaybackSource, GuessSongServiceError } from '@/lib/guess-song-session'
import {
  getGuessSongMediaCacheKey,
  getGuessSongMediaConfig,
  matchesGuessSongMediaTicket,
  parseGuessSongMediaRequest,
  verifyGuessSongMediaTicket,
} from '@/lib/guess-song-media-ticket'
import { requireUser } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function denied(status: number) {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
    },
  })
}

async function handle(request: Request) {
  let config
  try {
    config = getGuessSongMediaConfig()
  } catch (error) {
    console.error('[guess-song.media-authorize.config]', error instanceof Error ? error.message : 'CONFIG_ERROR')
    return denied(503)
  }
  if (!config.enabled) return denied(403)

  let guard
  try {
    guard = await requireUser()
  } catch {
    return denied(503)
  }
  if (!guard.user) return denied(guard.response.status === 401 ? 401 : 403)

  const binding = parseGuessSongMediaRequest(request)
  if (!binding) return denied(403)

  const ticket = verifyGuessSongMediaTicket(binding.ticket)
  const expectedBinding = {
    sessionId: binding.sessionId,
    userId: guard.user.id,
    questionId: binding.questionId,
    requestKey: binding.requestKey,
  }
  if (!matchesGuessSongMediaTicket(ticket, expectedBinding) || ticket?.userId !== guard.user.id) {
    return denied(403)
  }

  try {
    const source = await getGuessSongPlaybackSource({
      userId: guard.user.id,
      sessionId: binding.sessionId,
      publicQuestionId: binding.questionId,
      requestKey: binding.requestKey,
    })
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Media-Cache-Key': getGuessSongMediaCacheKey(source.storagePath),
      },
    })
  } catch (error) {
    if (error instanceof GuessSongServiceError) return denied(error.status >= 500 ? 503 : 403)
    console.warn('[guess-song.media-authorize.failed]', 'MEDIA_AUTHORIZE_FAILED')
    return denied(503)
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function HEAD(request: Request) {
  return handle(request)
}
