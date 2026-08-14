import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

import { invalidateBannedWordCache, normalizeBannedWord } from '@/lib/content-moderation'
import { startModerationScan } from '@/lib/content-moderation-job'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ id: string }> }

const wordSelect = {
  id: true,
  word: true,
  normalizedWord: true,
  enabled: true,
  priority: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, uid: true, nickname: true } },
} as const

function serializeWord(row: {
  id: string
  word: string
  normalizedWord: string
  enabled: boolean
  priority: string
  note: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: { id: string; uid: number; nickname: string } | null
}) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

export async function PATCH(request: Request, context: Context) {
  const guard = await requireAdmin('banned_word_manage')
  if (!guard.user) return guard.response
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const data: {
    word?: string
    normalizedWord?: string
    enabled?: boolean
    priority?: 'NORMAL' | 'HIGH'
    note?: string | null
  } = {}

  if (typeof body?.word === 'string') {
    const word = sanitizeText(body.word, 100).trim()
    const normalizedWord = normalizeBannedWord(word)
    if (!word || !normalizedWord) return NextResponse.json({ error: 'INVALID_BANNED_WORD', message: '请输入违禁词。' }, { status: 400 })
    data.word = word
    data.normalizedWord = normalizedWord
  }
  if (typeof body?.enabled === 'boolean') data.enabled = body.enabled
  if (body?.priority === 'HIGH' || body?.priority === 'NORMAL') data.priority = body.priority
  if (body && Object.prototype.hasOwnProperty.call(body, 'note')) data.note = sanitizeText(body.note, 500) || null
  if (!Object.keys(data).length) return NextResponse.json({ error: 'NO_FIELDS', message: '没有可更新的字段。' }, { status: 400 })

  try {
    const updated = await prisma.bannedWord.update({ where: { id }, data, select: wordSelect })
    invalidateBannedWordCache()
    const scanJob = await startModerationScan()
    return NextResponse.json({ word: serializeWord(updated), scanJobId: scanJob.id, message: '违禁词已更新。' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'BANNED_WORD_EXISTS', message: '该违禁词已存在' }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'BANNED_WORD_NOT_FOUND', message: '违禁词不存在。' }, { status: 404 })
    }
    console.error('[admin:banned-words:update]', error)
    return NextResponse.json({ error: 'BANNED_WORD_UPDATE_FAILED', message: '违禁词更新失败，请稍后重试。' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: Context) {
  const guard = await requireAdmin('banned_word_manage')
  if (!guard.user) return guard.response
  const { id } = await context.params

  try {
    // Keep a disabled tombstone so a legacy SensitiveWord with the same
    // normalized value cannot silently re-enable the rule.
    await prisma.bannedWord.update({ where: { id }, data: { enabled: false } })
    invalidateBannedWordCache()
    return NextResponse.json({ message: '违禁词已删除。' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'BANNED_WORD_NOT_FOUND', message: '违禁词不存在。' }, { status: 404 })
    }
    console.error('[admin:banned-words:delete]', error)
    return NextResponse.json({ error: 'BANNED_WORD_DELETE_FAILED', message: '违禁词删除失败，请稍后重试。' }, { status: 500 })
  }
}
