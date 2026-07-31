import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

const BULK_MAX_IDS = 500
const BULK_ACTIONS = ['publish', 'unpublish', 'draft', 'poster'] as const
type BulkAction = (typeof BULK_ACTIONS)[number]

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = (await request.json().catch(() => null)) as {
    ids?: unknown
    action?: string
    posterUrl?: unknown
  } | null
  const rawIds = Array.isArray(body?.ids) ? (body.ids as unknown[]) : []
  const ids = [...new Set(rawIds.map((item) => String(item ?? '').trim()).filter((value) => Boolean(value)))]
    .slice(0, BULK_MAX_IDS)
  if (!ids.length) return NextResponse.json({ message: '请至少选择一个场次' }, { status: 400 })
  const action = body?.action as BulkAction
  if (!BULK_ACTIONS.includes(action)) return NextResponse.json({ message: '未知批量操作' }, { status: 400 })

  let data: Prisma.MusicConcertUpdateManyMutationInput
  if (action === 'publish') data = { status: 'PUBLISHED' }
  else if (action === 'unpublish' || action === 'draft') data = { status: 'DRAFT' }
  else {
    const posterUrl = sanitizeText(body?.posterUrl, 1000)
    if (!posterUrl || !/^https?:\/\//i.test(posterUrl)) {
      return NextResponse.json({ message: '请提供有效的海报地址' }, { status: 400 })
    }
    data = { posterUrl }
  }

  const existing = await prisma.musicConcert.findMany({ where: { id: { in: ids } }, select: { id: true } })
  const existingIds = new Set(existing.map((item) => item.id))
  const notFound = ids.filter((id) => !existingIds.has(id))
  if (notFound.length) {
    return NextResponse.json({ message: `有 ${notFound.length} 个场次不存在或已被删除`, notFound }, { status: 404 })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.musicConcert.updateMany({ where: { id: { in: ids } }, data })
      return result.count
    })
    const label = action === 'publish' ? '发布' : action === 'poster' ? '更新海报' : '转为草稿'
    return NextResponse.json({ ok: true, updated, message: `已${label} ${updated} 个场次` })
  } catch (error) {
    console.error('[concert.bulk]', error)
    return NextResponse.json({ message: '批量操作失败，请重试' }, { status: 500 })
  }
}
