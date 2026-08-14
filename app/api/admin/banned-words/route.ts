import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

import { requireAdmin, sanitizeText } from '@/lib/security'
import { invalidateBannedWordCache, normalizeBannedWord } from '@/lib/content-moderation'
import { startModerationScan } from '@/lib/content-moderation-job'
import { prisma } from '@/lib/prisma'

function serializeWord(row: {
  id: string
  word: string
  normalizedWord: string
  enabled: boolean
  priority: 'NORMAL' | 'HIGH'
  note: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: { id: string; uid: number; nickname: string } | null
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

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

export async function GET() {
  const guard = await requireAdmin('banned_word_manage')
  if (!guard.user) return guard.response

  const rows = await prisma.bannedWord.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], select: wordSelect })
  return NextResponse.json({ words: rows.map(serializeWord) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('banned_word_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const word = sanitizeText(body?.word, 100).trim()
  const normalizedWord = normalizeBannedWord(word)
  if (!word || !normalizedWord) return NextResponse.json({ error: 'INVALID_BANNED_WORD', message: '请输入违禁词。' }, { status: 400 })

  try {
    const created = await prisma.bannedWord.create({
      data: {
        word,
        normalizedWord,
        enabled: body?.enabled !== false,
        priority: body?.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
        note: sanitizeText(body?.note, 500) || null,
        createdById: guard.user.id,
      },
      select: wordSelect,
    })
    invalidateBannedWordCache()
    const scanJob = await startModerationScan()
    return NextResponse.json({ word: serializeWord(created), scanJobId: scanJob.id, message: '违禁词已新增，历史内容扫描已开始。' }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'BANNED_WORD_EXISTS', message: '该违禁词已存在' }, { status: 409 })
    }
    console.error('[admin:banned-words:create]', error)
    return NextResponse.json({ error: 'BANNED_WORD_CREATE_FAILED', message: '违禁词保存失败，请稍后重试。' }, { status: 500 })
  }
}
