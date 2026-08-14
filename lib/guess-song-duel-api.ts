import { NextResponse } from 'next/server'
import { GuessSongDuelServiceError } from '@/lib/guess-song-duel-service'

export const duelPrivateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

export function duelOk<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true, ...((data && typeof data === 'object') ? data : { data }) }, { ...init, headers: { ...duelPrivateHeaders, ...(init.headers || {}) } })
}

export function duelError(error: unknown, fallback = 'Duel request failed') {
  if (error instanceof GuessSongDuelServiceError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: duelPrivateHeaders })
  }
  console.error('[guess-song-duel.api]', error)
  return NextResponse.json({ ok: false, code: 'DUEL_REQUEST_FAILED', message: fallback }, { status: 500, headers: duelPrivateHeaders })
}

export function duelInputError(message: string, code = 'DUEL_INPUT_INVALID', status = 400) {
  return duelError(new GuessSongDuelServiceError(message, status, code))
}

export function readString(value: unknown, maxLength = 128) {
  if (typeof value !== 'string') return undefined
  return value.slice(0, maxLength)
}
