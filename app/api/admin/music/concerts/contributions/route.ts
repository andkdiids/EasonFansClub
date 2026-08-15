import { NextResponse } from 'next/server'
import { type Prisma } from '@prisma/client'
import { contributionStatusLabel, contributionTypeLabel } from '@/lib/music-contributions'
import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

function validType(value: string | null) {
  return value === 'SHOW' || value === 'SETLIST' || value === 'ENCORE' ? value : null
}

function validStatus(value: string | null) {
  return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED' || value === 'WITHDRAWN' ? value : 'PENDING'
}

const include = {
  submitter: { select: { id: true, uid: true, username: true, nickname: true, avatarUrl: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
  reviewer: { select: { id: true, uid: true, username: true, nickname: true } },
  targetShow: { select: { id: true, city: true, concertDate: true, venue: true, title: true, MusicTour: { select: { id: true, name: true } } } },
} as const

function serialize(item: Prisma.ConcertContributionGetPayload<{ include: typeof include }>) {
  return {
    ...item,
    typeLabel: contributionTypeLabel(item.type),
    statusLabel: contributionStatusLabel(item.status),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    reviewedAt: item.reviewedAt?.toISOString() || null,
    submitter: {
      ...item.submitter,
      avatarUrl: publicImageUrl(item.submitter.Profile?.avatarUrl || item.submitter.avatarUrl),
      displayName: item.submitter.Profile?.displayName || item.submitter.nickname || item.submitter.username,
    },
    targetShow: item.targetShow ? { ...item.targetShow, concertDate: item.targetShow.concertDate.toISOString() } : null,
  }
}

export async function GET(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const status = validStatus(params.get('status'))
  const type = validType(params.get('type'))
  const q = sanitizeText(params.get('q'), 100)
  const numericUid = q ? Number(q) : NaN
  const submitterFilters = q ? [
    { username: { contains: q } },
    { nickname: { contains: q } },
    ...(Number.isInteger(numericUid) ? [{ uid: numericUid }] : []),
  ] : []
  const contributions = await prisma.concertContribution.findMany({
    where: {
      status,
      ...(type ? { type } : {}),
      ...(submitterFilters.length ? { submitter: { OR: submitterFilters } } : {}),
    },
    orderBy: status === 'PENDING' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    include,
  })
  return NextResponse.json({ contributions: contributions.map(serialize), status, type }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
