import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildGuessSongMediaUrl,
  createGuessSongMediaTicket,
  getGuessSongMediaConfig,
  matchesGuessSongMediaTicket,
  parseGuessSongMediaRequest,
  verifyGuessSongMediaTicket,
} from '@/lib/guess-song-media-ticket'

const ENV_KEYS = [
  'GUESS_SONG_MEDIA_GATEWAY_ENABLED',
  'GUESS_SONG_MEDIA_GATEWAY_BASE_URL',
  'GUESS_SONG_MEDIA_TICKET_SECRET',
  'GUESS_SONG_MEDIA_TICKET_EXPIRES',
] as const

function withEnvironment(values: Record<(typeof ENV_KEYS)[number], string | undefined>, callback: () => void) {
  const environment = process.env as Record<string, string | undefined>
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, environment[key]]))
  try {
    for (const key of ENV_KEYS) {
      const value = values[key]
      if (value === undefined) delete environment[key]
      else environment[key] = value
    }
    callback()
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key]
      if (value === undefined) delete environment[key]
      else environment[key] = value
    }
  }
}

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('Guess Song media ticket signs the full playback binding and rejects tampering', () => {
  withEnvironment({
    GUESS_SONG_MEDIA_GATEWAY_ENABLED: 'true',
    GUESS_SONG_MEDIA_GATEWAY_BASE_URL: 'https://media.example.test/',
    GUESS_SONG_MEDIA_TICKET_SECRET: 'unit-test-ticket-secret',
    GUESS_SONG_MEDIA_TICKET_EXPIRES: '300',
  }, () => {
    const now = 1_700_000_000_000
    const binding = {
      sessionId: 'session-a',
      userId: 'user-a',
      questionId: 'question-a',
      requestKey: 'request-key-a',
    }
    const ticket = createGuessSongMediaTicket(binding, now, 300)
    const payload = verifyGuessSongMediaTicket(ticket, now + 1_000)

    assert.deepEqual(payload && {
      sessionId: payload.sessionId,
      userId: payload.userId,
      questionId: payload.questionId,
      requestKey: payload.requestKey,
    }, binding)
    assert.equal(matchesGuessSongMediaTicket(payload, binding), true)
    assert.equal(matchesGuessSongMediaTicket(payload, { ...binding, userId: 'user-b' }), false)
    assert.equal(matchesGuessSongMediaTicket(payload, { ...binding, questionId: 'question-b' }), false)
    assert.equal(matchesGuessSongMediaTicket(payload, { ...binding, requestKey: 'request-key-b' }), false)
    assert.equal(verifyGuessSongMediaTicket(null, now), null)
    assert.equal(verifyGuessSongMediaTicket(`${ticket.slice(0, -1)}${ticket.endsWith('a') ? 'b' : 'a'}`, now), null)
    assert.equal(verifyGuessSongMediaTicket(ticket, now + 300_000), null)

    const url = new URL(buildGuessSongMediaUrl(binding))
    assert.equal(url.origin, 'https://media.example.test')
    assert.equal(url.pathname, '/private/guess-song/session-a/question-a')
    assert.equal(url.searchParams.get('requestKey'), binding.requestKey)
    const urlTicket = verifyGuessSongMediaTicket(url.searchParams.get('ticket'))
    assert.equal(matchesGuessSongMediaTicket(urlTicket, binding), true)
    const internalRequest = new Request('https://ecfc.fans/api/internal/media/guess-song/origin?sessionId=session-a&questionId=question-a', {
      headers: {
        'X-ECFC-Media-Request-Key': binding.requestKey,
        'X-ECFC-Media-Ticket': url.searchParams.get('ticket') || '',
      },
    })
    assert.deepEqual(parseGuessSongMediaRequest(internalRequest), {
      sessionId: binding.sessionId,
      questionId: binding.questionId,
      requestKey: binding.requestKey,
      ticket: url.searchParams.get('ticket'),
    })
    assert.doesNotMatch(url.toString(), /storagePath|SecretKey|Authorization/i)
  })
})

test('media flag off keeps the old URL mode and flag on requires a ticket secret', () => {
  withEnvironment({
    GUESS_SONG_MEDIA_GATEWAY_ENABLED: 'false',
    GUESS_SONG_MEDIA_GATEWAY_BASE_URL: undefined,
    GUESS_SONG_MEDIA_TICKET_SECRET: undefined,
    GUESS_SONG_MEDIA_TICKET_EXPIRES: undefined,
  }, () => {
    assert.equal(getGuessSongMediaConfig().enabled, false)
  })

  withEnvironment({
    GUESS_SONG_MEDIA_GATEWAY_ENABLED: 'true',
    GUESS_SONG_MEDIA_GATEWAY_BASE_URL: 'https://media.example.test',
    GUESS_SONG_MEDIA_TICKET_SECRET: undefined,
    GUESS_SONG_MEDIA_TICKET_EXPIRES: '300',
  }, () => {
    assert.throws(() => getGuessSongMediaConfig(), /ticket secret is not configured/)
  })
})

test('media gateway wiring preserves the legacy route and protects the new origin', () => {
  const session = source('lib/guess-song-session.ts')
  const game = source('app/entertainment/guess-song/GuessSongGame.tsx')
  const authorize = source('app/api/internal/media/guess-song/authorize/route.ts')
  const origin = source('app/api/internal/media/guess-song/origin/route.ts')
  const nginx = source('deploy/nginx/ecfc-media-private-audio.conf.example')

  assert.match(session, /getGuessSongMediaConfig\(\)/)
  assert.match(session, /buildGuessSongMediaUrl\(/)
  assert.match(session, /\/api\/entertainment\/guess-song\/sessions\//)
  assert.match(session, /playCount: \{ increment: 1 \}/)
  assert.match(game, /audio\.src = data\.audioUrl/)
  assert.match(game, /fetch|api</)
  assert.match(authorize, /requireUser\(\)/)
  assert.match(authorize, /getGuessSongPlaybackSource\(/)
  assert.match(authorize, /X-Media-Cache-Key/)
  assert.match(origin, /isValidMediaGatewaySecret/)
  assert.match(origin, /X-ECFC-Media-Gateway|x-ecfc-media-gateway/)
  assert.match(origin, /source\.storagePath/)
  assert.match(origin, /streamProtectedGuessSongAudio\(/)
  assert.match(nginx, /auth_request\s+\/_ecfc_guess_song_media_auth/)
  assert.match(nginx, /auth_request_set\s+\$guess_song_cache_key/)
  assert.match(nginx, /proxy_cache_key/)
  assert.match(nginx, /\$slice_range/)
  assert.match(nginx, /proxy_set_header X-ECFC-Media-Ticket \$arg_ticket/)
  assert.match(nginx, /proxy_set_header Cookie ""/)
  assert.doesNotMatch(nginx, /origin\?[^\r\n]*ticket=/)
  assert.doesNotMatch(nginx, /authorize\?[^\r\n]*ticket=/)
  assert.doesNotMatch(nginx, /TENCENT_COS_SECRET_(?:ID|KEY)|SecretKey/i)
})
