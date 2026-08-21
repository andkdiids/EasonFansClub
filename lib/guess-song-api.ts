import { NextResponse } from 'next/server'
import { GuessSongServiceError } from '@/lib/guess-song-session'

export function guessSongOk<T>(data: T, status = 200) {
  return NextResponse.json(
    { ok: true, data, error: null },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export function guessSongError(error: string, status: number, code?: string) {
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store' }
  if (status === 429) headers['Retry-After'] = '1'
  return NextResponse.json(
    { ok: false, data: null, error, code },
    { status, headers },
  )
}

export function handleGuessSongError(error: unknown, operation: string) {
  if (error instanceof GuessSongServiceError) {
    return guessSongError(error.message, error.status, error.code)
  }
  if (
    error instanceof Error
    && (
      error.name === 'GuessSongAudioProcessingError'
      || error.name === 'GuessSongStorageError'
      || error.name === 'GuessSongMediaTicketError'
    )
  ) {
    return guessSongError(error.message, 503, error.name)
  }
  console.error(`[guess-song.${operation}]`, error)
  return guessSongError('E声猜歌服务暂时不可用，请稍后再试', 500, 'SERVICE_UNAVAILABLE')
}
