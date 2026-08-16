import { NextResponse } from 'next/server'
import { UndercoverStarServiceError } from '@/lib/undercover-star'

export const undercoverPrivateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

export function undercoverOk<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true, data }, { ...init, headers: { ...undercoverPrivateHeaders, ...(init.headers || {}) } })
}

export function undercoverError(error: unknown, fallback = '卧底巨星请求失败') {
  if (error instanceof UndercoverStarServiceError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status, headers: undercoverPrivateHeaders })
  }
  console.error('[undercover-star.api]', error)
  return NextResponse.json({ ok: false, code: 'UNDERCOVER_REQUEST_FAILED', error: fallback }, { status: 500, headers: undercoverPrivateHeaders })
}

export function undercoverInputError(message: string, code = 'UNDERCOVER_INPUT_INVALID', status = 400) {
  return undercoverError(new UndercoverStarServiceError(message, status, code))
}

export function readUndercoverString(value: unknown, maxLength = 191) {
  if (typeof value !== 'string') return undefined
  return value.slice(0, maxLength)
}

export function readUndercoverInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/u.test(value.trim())) return Number(value)
  return undefined
}
