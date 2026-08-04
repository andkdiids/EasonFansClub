import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { buildConcertSequenceUpdates, cloneSetlistItems } from '@/lib/music-concert-admin'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

const BULK_MAX_IDS = 500
const BULK_ACTIONS = ['publish', 'unpublish', 'draft', 'poster', 'delete', 'copy-setlist'] as const
type BulkAction = (typeof BULK_ACTIONS)[number]

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = (await request.json().catch(() => null)) as {
    ids?: unknown
    action?: string
    posterUrl?: unknown
    sourceConcertId?: unknown
  } | null
  const rawIds = Array.isArray(body?.ids) ? (body.ids as unknown[]) : []
  const ids = [...new Set(rawIds.map((item) => String(item ?? '').trim()).filter((value) => Boolean(value)))]
    .slice(0, BULK_MAX_IDS)
  if (!ids.length) return NextResponse.json({ message: '请至少选择一个场次' }, { status: 400 })
  const action = body?.action as BulkAction
  if (!BULK_ACTIONS.includes(action)) return NextResponse.json({ message: '未知批量操作' }, { status: 400 })

  const sourceConcertId = sanitizeText(body?.sourceConcertId, 100)
  let data: Prisma.MusicConcertUpdateManyMutationInput | null = null
  if (action === 'publish') data = { status: 'PUBLISHED' }
  else if (action === 'unpublish' || action === 'draft') data = { status: 'DRAFT' }
  else if (action === 'poster') {
    const posterUrl = sanitizeText(body?.posterUrl, 1000)
    if (!posterUrl || !/^https?:\/\//i.test(posterUrl)) {
      return NextResponse.json({ message: '请提供有效的海报地址' }, { status: 400 })
    }
    data = { posterUrl }
  }

  const existing = await prisma.musicConcert.findMany({ where: { id: { in: ids } }, select: { id: true, tourId: true, _count: { select: { UserMusicConcert: true } } } })
  const existingIds = new Set(existing.map((item) => item.id))
  const notFound = ids.filter((id) => !existingIds.has(id))
  if (notFound.length) {
    return NextResponse.json({ message: `有 ${notFound.length} 个场次不存在或已被删除`, notFound }, { status: 404 })
  }

  if (action === 'delete') {
    const blocked = existing.filter((item) => item._count.UserMusicConcert > 0)
    if (blocked.length) return NextResponse.json({ message: `已选 ${blocked.length} 个场次存在观演记录，不能批量删除`, blockedIds: blocked.map((item) => item.id) }, { status: 409 })
  }

  const source = action === 'copy-setlist'
    ? await prisma.musicConcert.findUnique({
      where: { id: sourceConcertId },
      select: {
        id: true,
        tourId: true,
        MusicConcertSetlistItem: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { songId: true, displayName: true, section: true, position: true, versionName: true, note: true, isEncore: true, isRequest: true, isDebut: true, isGuest: true, isMedley: true, isSpecial: true },
        },
      },
    })
    : null
  if (action === 'copy-setlist') {
    if (!sourceConcertId) return NextResponse.json({ message: '请选择歌单来源场次' }, { status: 400 })
    if (!source) return NextResponse.json({ message: '歌单来源场次不存在或已被删除' }, { status: 404 })
    if (existing.some((item) => item.tourId !== source.tourId)) return NextResponse.json({ message: '来源场次必须与所选场次属于同一巡演' }, { status: 400 })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (action === 'delete') {
        const tours = await tx.musicConcert.findMany({ where: { id: { in: ids } }, select: { tourId: true } })
        const result = await tx.musicConcert.deleteMany({ where: { id: { in: ids } } })
        for (const tourId of new Set(tours.map((item) => item.tourId))) {
          const rows = await tx.musicConcert.findMany({ where: { tourId }, select: { id: true, city: true, concertDate: true, createdAt: true, sortOrder: true } })
          for (const sequence of buildConcertSequenceUpdates(rows)) {
            await tx.musicConcert.update({ where: { id: sequence.id }, data: { sessionNumber: sequence.sessionNumber, sortOrder: sequence.sortOrder } })
          }
        }
        return result.count
      }
      if (action === 'copy-setlist' && source) {
        const targetIds = ids.filter((id) => id !== source.id)
        for (const targetId of targetIds) {
          await tx.musicConcertSetlistItem.deleteMany({ where: { concertId: targetId } })
          const items = cloneSetlistItems(source.MusicConcertSetlistItem, targetId)
          if (items.length) await tx.musicConcertSetlistItem.createMany({ data: items })
        }
        return targetIds.length
      }
      const result = await tx.musicConcert.updateMany({ where: { id: { in: ids } }, data: data || {} })
      return result.count
    })
    const label = action === 'publish' ? '发布' : action === 'poster' ? '更新海报' : action === 'delete' ? '删除' : action === 'copy-setlist' ? '复制歌单' : '转为草稿'
    return NextResponse.json({ ok: true, updated, message: `已${label} ${updated} 个场次` })
  } catch (error) {
    console.error('[concert.bulk]', error)
    return NextResponse.json({ message: '批量操作失败，请重试' }, { status: 500 })
  }
}
