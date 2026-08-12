import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_MEDIA_GATEWAY_BASE_URL = 'https://media.ecfc.fans'
const DEFAULT_TICKET_EXPIRES_SECONDS = 5 * 60
const MIN_TICKET_EXPIRES_SECONDS = 60
const MAX_TICKET_EXPIRES_SECONDS = 15 * 60
const TICKET_VERSION = 1
const MAX_TICKET_LENGTH = 4096

export type GuessSongMediaTicketInput = {
  sessionId: string
  userId: string
  questionId: string
  requestKey: string
}

export type GuessSongMediaTicketPayload = GuessSongMediaTicketInput & {
  version: typeof TICKET_VERSION
  mediaType: 'guess-song'
  issuedAt: number
  expiresAt: number
}

export type GuessSongMediaConfig = {
  enabled: boolean
  baseUrl: string
  ticketExpiresSeconds: number
}

export class GuessSongMediaTicketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuessSongMediaTicketError'
  }
}

function readTicketSecret() {
  return process.env.GUESS_SONG_MEDIA_TICKET_SECRET?.trim() || ''
}

function parseTicketExpiresSeconds(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= MIN_TICKET_EXPIRES_SECONDS && parsed <= MAX_TICKET_EXPIRES_SECONDS
    ? parsed
    : DEFAULT_TICKET_EXPIRES_SECONDS
}

function safeComponent(value: string, name: string) {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new GuessSongMediaTicketError(`Invalid media ticket ${name}`)
  }
  return normalized
}

function signEncodedPayload(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function signaturesEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function payloadMatchesInput(payload: GuessSongMediaTicketPayload, input: GuessSongMediaTicketInput) {
  return payload.sessionId === input.sessionId
    && payload.userId === input.userId
    && payload.questionId === input.questionId
    && payload.requestKey === input.requestKey
}

export function isGuessSongMediaGatewayEnabled() {
  const value = process.env.GUESS_SONG_MEDIA_GATEWAY_ENABLED?.trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes'
}

export function getGuessSongMediaConfig(): GuessSongMediaConfig {
  const enabled = isGuessSongMediaGatewayEnabled()
  const baseUrl = (process.env.GUESS_SONG_MEDIA_GATEWAY_BASE_URL?.trim() || DEFAULT_MEDIA_GATEWAY_BASE_URL).replace(/\/+$/, '')
  const ticketExpiresSeconds = parseTicketExpiresSeconds(process.env.GUESS_SONG_MEDIA_TICKET_EXPIRES)

  if (!enabled) return { enabled, baseUrl, ticketExpiresSeconds }

  if (!readTicketSecret()) {
    throw new GuessSongMediaTicketError('Guess Song media ticket secret is not configured')
  }

  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('UNSUPPORTED_MEDIA_GATEWAY_PROTOCOL')
  } catch {
    throw new GuessSongMediaTicketError('Guess Song media gateway base URL is invalid')
  }

  return { enabled, baseUrl, ticketExpiresSeconds }
}

export function createGuessSongMediaTicket(
  input: GuessSongMediaTicketInput,
  now = Date.now(),
  expiresInSeconds = parseTicketExpiresSeconds(process.env.GUESS_SONG_MEDIA_TICKET_EXPIRES),
) {
  const secret = readTicketSecret()
  if (!secret) throw new GuessSongMediaTicketError('Guess Song media ticket secret is not configured')

  const issuedAt = Math.floor(now / 1000)
  const payload: GuessSongMediaTicketPayload = {
    version: TICKET_VERSION,
    mediaType: 'guess-song',
    sessionId: safeComponent(input.sessionId, 'sessionId'),
    userId: safeComponent(input.userId, 'userId'),
    questionId: safeComponent(input.questionId, 'questionId'),
    requestKey: safeComponent(input.requestKey, 'requestKey'),
    issuedAt,
    expiresAt: issuedAt + expiresInSeconds,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encodedPayload}.${signEncodedPayload(encodedPayload, secret)}`
}

export function verifyGuessSongMediaTicket(value: string | null | undefined, now = Date.now()) {
  const secret = readTicketSecret()
  const ticket = value?.trim() || ''
  if (!secret || !ticket || ticket.length > MAX_TICKET_LENGTH) return null

  const parts = ticket.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [encodedPayload, signature] = parts
  if (!signaturesEqual(signature, signEncodedPayload(encodedPayload, secret))) return null

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<GuessSongMediaTicketPayload>
    if (
      parsed.version !== TICKET_VERSION
      || parsed.mediaType !== 'guess-song'
      || typeof parsed.issuedAt !== 'number'
      || !Number.isSafeInteger(parsed.issuedAt)
      || typeof parsed.expiresAt !== 'number'
      || !Number.isSafeInteger(parsed.expiresAt)
      || parsed.expiresAt - parsed.issuedAt < MIN_TICKET_EXPIRES_SECONDS
      || parsed.expiresAt - parsed.issuedAt > MAX_TICKET_EXPIRES_SECONDS
      || parsed.expiresAt <= Math.floor(now / 1000)
      || typeof parsed.sessionId !== 'string'
      || typeof parsed.userId !== 'string'
      || typeof parsed.questionId !== 'string'
      || typeof parsed.requestKey !== 'string'
    ) return null

    const payload: GuessSongMediaTicketPayload = {
      version: TICKET_VERSION,
      mediaType: 'guess-song',
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
      sessionId: safeComponent(parsed.sessionId, 'sessionId'),
      userId: safeComponent(parsed.userId, 'userId'),
      questionId: safeComponent(parsed.questionId, 'questionId'),
      requestKey: safeComponent(parsed.requestKey, 'requestKey'),
    }
    return payload
  } catch {
    return null
  }
}

export function matchesGuessSongMediaTicket(payload: GuessSongMediaTicketPayload | null, input: GuessSongMediaTicketInput) {
  return Boolean(payload && payloadMatchesInput(payload, input))
}

export function buildGuessSongMediaUrl(
  input: GuessSongMediaTicketInput,
  config: GuessSongMediaConfig = getGuessSongMediaConfig(),
) {
  if (!config.enabled) throw new GuessSongMediaTicketError('Guess Song media gateway is disabled')
  const ticket = createGuessSongMediaTicket(input, Date.now(), config.ticketExpiresSeconds)
  const url = new URL(
    `/private/guess-song/${encodeURIComponent(input.sessionId)}/${encodeURIComponent(input.questionId)}`,
    config.baseUrl,
  )
  url.searchParams.set('requestKey', input.requestKey)
  url.searchParams.set('ticket', ticket)
  return url.toString()
}

export function parseGuessSongMediaRequest(request: Request) {
  const url = new URL(request.url)
  const value = (headerName: string, queryName: string) => request.headers.get(headerName)?.trim() || url.searchParams.get(queryName)?.trim() || ''
  const sessionId = value('x-ecfc-media-session-id', 'sessionId')
  const questionId = value('x-ecfc-media-question-id', 'questionId')
  const requestKey = value('x-ecfc-media-request-key', 'requestKey')
  const ticket = value('x-ecfc-media-ticket', 'ticket')
  if (!sessionId || !questionId || !requestKey || !ticket || ticket.length > MAX_TICKET_LENGTH) return null
  return { sessionId, questionId, requestKey, ticket }
}

export function getGuessSongMediaCacheKey(storagePath: string) {
  return createHash('sha256').update(`guess-song:${storagePath}`).digest('hex')
}

export function isValidMediaGatewaySecret(value: string | null | undefined) {
  const expected = process.env.MEDIA_GATEWAY_SECRET?.trim() || ''
  const received = value?.trim() || ''
  return Boolean(expected && received) && signaturesEqual(received, expected)
}
