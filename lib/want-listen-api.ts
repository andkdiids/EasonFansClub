import { NextResponse } from 'next/server'
import { WantListenServiceError } from '@/lib/want-listen'

export function wantListenOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data, error: null }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function wantListenError(error: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, data: null, error, code }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function handleWantListenError(error: unknown, operation: string) {
  if (error instanceof WantListenServiceError) return wantListenError(error.message, error.status, error.code)
  console.error(`[want-listen.${operation}]`, error)
  return wantListenError('想听服务暂时不可用，请稍后再试。', 500, 'SERVICE_UNAVAILABLE')
}
