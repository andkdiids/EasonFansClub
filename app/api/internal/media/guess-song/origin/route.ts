import { getGuessSongPlaybackSource, GuessSongServiceError } from '@/lib/guess-song-session'
import {
  getGuessSongMediaConfig,
  isValidMediaGatewaySecret,
  matchesGuessSongMediaTicket,
  parseGuessSongMediaRequest,
  verifyGuessSongMediaTicket,
} from '@/lib/guess-song-media-ticket'
import { streamProtectedGuessSongAudio } from '@/lib/protected-audio'

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
  if (request.method !== 'GET' && request.method !== 'HEAD') return denied(405)
  if (!isValidMediaGatewaySecret(request.headers.get('x-ecfc-media-gateway'))) return denied(403)

  let config
  try {
    config = getGuessSongMediaConfig()
  } catch (error) {
    console.error('[guess-song.media-origin.config]', error instanceof Error ? error.message : 'CONFIG_ERROR')
    return denied(503)
  }
  if (!config.enabled) return denied(403)

  const binding = parseGuessSongMediaRequest(request)
  if (!binding) return denied(403)
  const ticket = verifyGuessSongMediaTicket(binding.ticket)
  if (!ticket || !matchesGuessSongMediaTicket(ticket, {
    sessionId: binding.sessionId,
    userId: ticket.userId,
    questionId: binding.questionId,
    requestKey: binding.requestKey,
  })) return denied(403)

  try {
    const source = await getGuessSongPlaybackSource({
      userId: ticket.userId,
      sessionId: binding.sessionId,
      publicQuestionId: binding.questionId,
      requestKey: binding.requestKey,
    })
    return streamProtectedGuessSongAudio(request, source.storagePath, {
      // This response is reachable only through the server-to-server gateway.
      // The public media location replaces this with private browser headers.
      cacheControl: 'public, max-age=300',
    })
  } catch (error) {
    if (error instanceof GuessSongServiceError) return denied(error.status >= 500 ? 503 : 403)
    console.warn('[guess-song.media-origin.failed]', error instanceof Error ? error.name : 'MEDIA_ORIGIN_FAILED')
    return denied(503)
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function HEAD(request: Request) {
  return handle(request)
}
