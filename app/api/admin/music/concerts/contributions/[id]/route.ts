import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { findPotentialDuplicateConcerts, parseContributionPayload, type ConcertContributionTypeValue, type SetlistContributionPayload, type ShowContributionPayload } from '@/lib/music-contributions'
import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

type Context = { params: Promise<{ id: string }> }

const include = {
  submitter: { select: { id: true, uid: true, username: true, nickname: true, avatarUrl: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
  reviewer: { select: { id: true, uid: true, username: true, nickname: true } },
  targetShow: {
    select: {
      id: true, title: true, city: true, countryOrRegion: true, venue: true, concertDate: true, startTime: true, endTime: true, stageType: true, posterUrl: true, description: true, status: true,
      MusicTour: { select: { id: true, name: true, category: true } },
      _count: { select: { MusicConcertSetlistItem: true } },
    },
  },
} as const

function typeValue(value: string): ConcertContributionTypeValue {
  return value === 'SETLIST' || value === 'ENCORE' ? value : 'SHOW'
}

function serialize(item: Prisma.ConcertContributionGetPayload<{ include: typeof include }>, extra: Record<string, unknown> = {}) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    reviewedAt: item.reviewedAt?.toISOString() || null,
    submitter: { ...item.submitter, avatarUrl: publicImageUrl(item.submitter.Profile?.avatarUrl || item.submitter.avatarUrl), displayName: item.submitter.Profile?.displayName || item.submitter.nickname || item.submitter.username },
    targetShow: item.targetShow ? { ...item.targetShow, concertDate: item.targetShow.concertDate.toISOString(), startTime: item.targetShow.startTime?.toISOString() || null, endTime: item.targetShow.endTime?.toISOString() || null, posterUrl: publicImageUrl(item.targetShow.posterUrl) } : null,
    ...extra,
  }
}

async function loadContribution(id: string) {
  return prisma.concertContribution.findUnique({ where: { id }, include })
}

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { id } = await params
  const contribution = await loadContribution(id)
  if (!contribution) return NextResponse.json({ message: '投稿不存在' }, { status: 404 })

  let duplicateShows: unknown[] = []
  let hasFormalSetlist = false
  let hasFormalEncore = false
  if (contribution.type === 'SHOW') {
    const parsed = parseContributionPayload('SHOW', contribution.payload)
    if (parsed.payload && 'tourId' in parsed.payload) duplicateShows = await findPotentialDuplicateConcerts(prisma, parsed.payload, contribution.targetShowId || undefined)
  } else if (contribution.targetShowId) {
    const [normalCount, encoreCount] = await Promise.all([
      prisma.musicConcertSetlistItem.count({ where: { concertId: contribution.targetShowId, isEncore: false } }),
      prisma.musicConcertSetlistItem.count({ where: { concertId: contribution.targetShowId, isEncore: true } }),
    ])
    hasFormalSetlist = normalCount > 0
    hasFormalEncore = encoreCount > 0
  }
  return NextResponse.json({ contribution: serialize(contribution, { duplicateShows, hasFormalSetlist, hasFormalEncore }) })
}

export async function PATCH(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { id } = await params
  const current = await prisma.concertContribution.findUnique({ where: { id }, select: { id: true, type: true, status: true } })
  if (!current) return NextResponse.json({ message: '投稿不存在' }, { status: 404 })
  if (current.status !== 'PENDING') return NextResponse.json({ message: '只有待审核投稿可以修改' }, { status: 409 })
  const body = await request.json().catch(() => null)
  const type = typeValue(current.type)
  const parsed = parseContributionPayload(type, body?.payload, { requireSongId: false })
  if (!parsed.payload) return NextResponse.json({ message: parsed.message || '投稿内容无效' }, { status: 400 })
  const payload = parsed.payload
  if (type === 'SHOW') {
    if (!await prisma.musicTour.findUnique({ where: { id: (payload as ShowContributionPayload).tourId }, select: { id: true } })) return NextResponse.json({ message: '所属巡演不存在' }, { status: 400 })
  } else {
    const setlistPayload = payload as SetlistContributionPayload
    if (!await prisma.musicConcert.findUnique({ where: { id: setlistPayload.targetShowId }, select: { id: true } })) return NextResponse.json({ message: '对应演唱会场次不存在' }, { status: 400 })
    const songIds = [...new Set(setlistPayload.items.map((item) => item.songId).filter((songId): songId is string => Boolean(songId)))]
    if (songIds.length && await prisma.musicSong.count({ where: { id: { in: songIds } } }) !== songIds.length) return NextResponse.json({ message: '歌单中包含不存在的曲库歌曲' }, { status: 400 })
  }
  const updatedCount = await prisma.concertContribution.updateMany({ where: { id, status: 'PENDING' }, data: { payload: payload as Prisma.InputJsonValue, targetShowId: type === 'SHOW' ? null : (payload as SetlistContributionPayload).targetShowId } })
  if (updatedCount.count !== 1) return NextResponse.json({ message: '投稿状态已变化，请刷新后重试' }, { status: 409 })
  const updated = await loadContribution(id)
  if (!updated) return NextResponse.json({ message: '投稿不存在' }, { status: 404 })
  return NextResponse.json({ contribution: serialize(updated), message: '审核内容已保存' })
}
