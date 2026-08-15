import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { findPotentialDuplicateConcerts, parseContributionPayload, type ConcertContributionTypeValue, type SetlistContributionPayload, type ShowContributionPayload, validateContributionSongs } from '@/lib/music-contributions'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

function typeValue(value: unknown): ConcertContributionTypeValue | null {
  return value === 'SHOW' || value === 'SETLIST' || value === 'ENCORE' ? value : null
}

function serializeContribution(item: {
  id: string
  type: string
  targetShowId: string | null
  payload: Prisma.JsonValue
  status: string
  reviewerId: string | null
  reviewedAt: Date | null
  reviewNote: string | null
  createdAt: Date
  updatedAt: Date
  targetShow: { id: string; city: string; concertDate: Date; venue: string | null; MusicTour: { name: string } } | null
}) {
  return {
    ...item,
    reviewedAt: item.reviewedAt?.toISOString() || null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    targetShow: item.targetShow ? { ...item.targetShow, concertDate: item.targetShow.concertDate.toISOString() } : null,
  }
}

const contributionInclude = {
  targetShow: { select: { id: true, city: true, concertDate: true, venue: true, MusicTour: { select: { name: true } } } },
} as const

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const status = params.get('status')
  const type = typeValue(params.get('type'))
  const contributions = await prisma.concertContribution.findMany({
    where: { submitterId: guard.user.id, ...(status && ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(status) ? { status: status as never } : {}), ...(type ? { type } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    include: contributionInclude,
  })
  return NextResponse.json({ contributions: contributions.map(serializeContribution) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const type = typeValue(body?.type)
  if (!type) return NextResponse.json({ message: '请选择投稿类型' }, { status: 400 })
  const parsed = parseContributionPayload(type, body?.payload, { requireSongId: true })
  if (!parsed.payload) return NextResponse.json({ message: parsed.message || '投稿内容无效' }, { status: 400 })
  const payload = parsed.payload

  if (type === 'SHOW') {
    const showPayload = payload as ShowContributionPayload
    const tour = await prisma.musicTour.findFirst({ where: { id: showPayload.tourId, status: 'PUBLISHED' }, select: { id: true } })
    if (!tour) return NextResponse.json({ message: '请选择有效的已发布巡演' }, { status: 400 })
    const duplicates = await findPotentialDuplicateConcerts(prisma, showPayload)
    if (duplicates.length && body?.confirmDuplicate !== true) {
      return NextResponse.json({ code: 'POSSIBLE_DUPLICATE', message: '似乎已经存在相同场次，请确认后再提交。', duplicates }, { status: 409 })
    }
  } else {
    const setlistPayload = payload as SetlistContributionPayload
    const target = await prisma.musicConcert.findFirst({ where: { id: setlistPayload.targetShowId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } }, select: { id: true } })
    if (!target) return NextResponse.json({ message: '请选择有效的已发布演唱会场次' }, { status: 400 })
    const songIds = [...new Set(setlistPayload.items.map((item) => item.songId).filter((id): id is string => Boolean(id)))]
    if (songIds.length) {
      const count = await prisma.musicSong.count({ where: { id: { in: songIds }, MusicAlbum: { status: 'PUBLISHED' } } })
      if (count !== songIds.length) return NextResponse.json({ message: '歌单中包含暂未找到的歌曲，请重新从曲库选择' }, { status: 400 })
    }
  }

  try {
    const created = await prisma.concertContribution.create({
      data: {
        type,
        submitterId: guard.user.id,
        targetShowId: type === 'SHOW' ? null : (payload as SetlistContributionPayload).targetShowId,
        payload: payload as Prisma.InputJsonValue,
        status: 'PENDING',
      },
      include: contributionInclude,
    })
    return NextResponse.json({ contribution: serializeContribution(created), message: '资料已提交，等待管理员审核' }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ message: '资料提交重复，请刷新后查看我的投稿' }, { status: 409 })
    throw error
  }
}
