import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { WantListenServiceError } from '@/lib/want-listen'

export function wantListenOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data, error: null }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function wantListenError(error: string, status: number, code?: string) {
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store' }
  if (status === 429) headers['Retry-After'] = '1'
  return NextResponse.json({ ok: false, data: null, error, code }, { status, headers })
}

function isMigrationOutOfSyncError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  // P2010/P2011/P2021：Raw query / 列 / 表不存在，通常是 schema 迁移未应用
  return error.code === 'P2010' || error.code === 'P2011' || error.code === 'P2021'
}

function detectDevice(userAgent: string | null | undefined) {
  const value = userAgent || ''
  if (/iPhone|iPad|iPod/i.test(value) || (/Macintosh/i.test(value) && /Mobile/i.test(value))) return 'MOBILE_IOS'
  if (/Android/i.test(value) && /Mobile/i.test(value)) return 'MOBILE_ANDROID'
  if (/Mobi|Mobile/i.test(value) || /Android/i.test(value)) return 'MOBILE'
  return 'DESKTOP'
}

export type WantListenErrorContext = {
  operation: string
  userId?: string
  mode?: unknown
  ip?: string | null
  userAgent?: string | null
}

export function handleWantListenError(error: unknown, operation: string, context: WantListenErrorContext = { operation }) {
  // instanceof 可能因模块被多个入口重复加载（不同实例）而失效，附加构造器名兜底
  const isServiceError = error instanceof WantListenServiceError
    || (typeof error === 'object' && error !== null && (error as Error | null)?.constructor?.name === 'WantListenServiceError')
  if (isServiceError) return wantListenError((error as WantListenServiceError).message, (error as WantListenServiceError).status, (error as WantListenServiceError).code)

  const device = detectDevice(context.userAgent)
  const name = error instanceof Error ? error.name : typeof error === 'object' && error ? String(error.constructor?.name || 'UnknownError') : 'UnknownError'
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  const migrationOutOfSync = isMigrationOutOfSyncError(error)
  const logContext = {
    operation,
    userId: context.userId,
    mode: context.mode,
    device,
    ip: context.ip,
    userAgent: context.userAgent,
    errorName: name,
    errorCode: migrationOutOfSync ? 'DATABASE_MIGRATION_OUT_OF_SYNC' : undefined,
    message,
    ...(stack ? { stack } : {}),
  }
  console.error(`[want-listen.${operation}]`, JSON.stringify(logContext))
  if (migrationOutOfSync) {
    // 数据库表结构与 Prisma schema 不一致（无尽模式迁移未应用）时的明确引导
    return wantListenError('想听服务暂时不可用，请稍后再试。', 500, 'DATABASE_MIGRATION_OUT_OF_SYNC')
  }
  return wantListenError('想听服务暂时不可用，请稍后再试。', 500, 'SERVICE_UNAVAILABLE')
}
