import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

type ConcertOrderRow = {
  id: string
  sortOrder: number
  concertDate: Date
  createdAt: Date
}

function compareConcerts(left: ConcertOrderRow, right: ConcertOrderRow, hasExplicitOrder: boolean) {
  if (hasExplicitOrder) {
    const leftOrder = left.sortOrder > 0 ? left.sortOrder : Number.MAX_SAFE_INTEGER
    const rightOrder = right.sortOrder > 0 ? right.sortOrder : Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
  }
  return left.concertDate.getTime() - right.concertDate.getTime()
    || left.createdAt.getTime() - right.createdAt.getTime()
    || left.id.localeCompare(right.id)
}

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const tourId = sanitizeText(body?.tourId, 100)
  const concertId = sanitizeText(body?.concertId, 100)
  const direction = body?.direction === 'down' ? 1 : body?.direction === 'up' ? -1 : 0
  if (!tourId || !concertId || !direction) return NextResponse.json({ message: '排序参数无效' }, { status: 400 })

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.musicConcert.findMany({
      where: { tourId },
      select: { id: true, sortOrder: true, concertDate: true, createdAt: true },
      orderBy: [{ sortOrder: 'asc' }, { concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    const hasExplicitOrder = rows.some((row) => row.sortOrder > 0)
    const ordered = [...rows].sort((left, right) => compareConcerts(left, right, hasExplicitOrder))
    const index = ordered.findIndex((row) => row.id === concertId)
    const target = index + direction
    if (index < 0) return { message: '场次不存在或不属于该巡演' as const }
    if (target < 0 || target >= ordered.length) return { message: '已经在排序边界' as const }
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    for (const [sortIndex, row] of ordered.entries()) {
      await tx.musicConcert.update({ where: { id: row.id }, data: { sortOrder: sortIndex + 1 } })
    }
    return { concerts: ordered }
  })

  if ('message' in result) return NextResponse.json({ message: result.message }, { status: 400 })
  return NextResponse.json({ ok: true, concerts: result.concerts })
}
