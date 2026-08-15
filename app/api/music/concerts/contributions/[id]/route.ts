import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { findPotentialDuplicateConcerts, parseContributionPayload, type ConcertContributionTypeValue, type SetlistContributionPayload, type ShowContributionPayload } from '@/lib/music-contributions'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

type Context = { params: Promise<{ id: string }> }

const contributionInclude = {
  targetShow: { select: { id: true, city: true, concertDate: true, venue: true, MusicTour: { select: { name: true } } } },
} as const

function typeValue(value: string): ConcertContributionTypeValue {
  return value === 'SHOW' || value === 'SETLIST' || value === 'ENCORE' ? value : 'SHOW'
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
  return { ...item, reviewedAt: item.reviewedAt?.toISOString() || null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), targetShow: item.targetShow ? { ...item.targetShow, concertDate: item.targetShow.concertDate.toISOString() } : null }
}

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { id } = await params
  const contribution = await prisma.concertContribution.findFirst({ where: { id, submitterId: guard.user.id }, include: contributionInclude })
  if (!contribution) return NextResponse.json({ message: '投稿不存在' }, { status: 404 })
  return NextResponse.json({ contribution: serializeContribution(contribution) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function PATCH(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { id } = await params
  const current = await prisma.concertContribution.findFirst({ where: { id, submitterId: guard.user.id }, select: { id: true, type: true, status: true } })
  if (!current) return NextResponse.json({ message: '投稿不存在' }, { status: 404 })
  if (current.status !== 'PENDING') return NextResponse.json({ message: '只有审核中的投稿可以编辑' }, { status: 409 })
  const body = await request.json().catch(() => null)
  const parsed = parseContributionPayload(typeValue(current.type), body?.payload, { requireSongId: true })
  if (!parsed.payload) return NextResponse.json({ message: parsed.message || '投稿内容无效' }, { status: 400 })
  const payload = parsed.payload
  if (current.type === 'SHOW') {
    const showPayload = payload as ShowContributionPayload
    const tour = await prisma.musicTour.findFirst({ where: { id: showPayload.tourId, status: 'PUBLISHED' }, select: { id: true } })
    if (!tour) return NextResponse.json({ message: '请选择有效的已发布巡演' }, { status: 400 })
    const duplicates = await findPotentialDuplicateConcerts(prisma, showPayload, undefined)
    if (duplicates.length && body?.confirmDuplicate !== true) return NextResponse.json({ code: 'POSSIBLE_DUPLICATE', message: '似乎已经存在相同场次，请确认后再保存。', duplicates }, { status: 409 })
  } else {
    const setlistPayload = payload as SetlistContributionPayload
    const target = await prisma.musicConcert.findFirst({ where: { id: setlistPayload.targetShowId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } }, select: { id: true } })
    if (!target) return NextResponse.json({ message: '请选择有效的已发布演唱会场次' }, { status: 400 })
    const songIds = [...new Set(setlistPayload.items.map((item) => item.songId).filter((songId): songId is string => Boolean(songId)))]
    if (songIds.length && await prisma.musicSong.count({ where: { id: { in: songIds }, MusicAlbum: { status: 'PUBLISHED' } } }) !== songIds.length) return NextResponse.json({ message: '歌单中包含暂未找到的歌曲，请重新从曲库选择' }, { status: 400 })
  }
  const result = await prisma.concertContribution.updateMany({ where: { id, submitterId: guard.user.id, status: 'PENDING' }, data: { payload: payload as Prisma.InputJsonValue, targetShowId: current.type === 'SHOW' ? null : (payload as SetlistContributionPayload).targetShowId } })
  if (result.count !== 1) return NextResponse.json({ message: '投稿状态已变化，请刷新后重试' }, { status: 409 })
  const updated = await prisma.concertContribution.findUniqueOrThrow({ where: { id }, include: contributionInclude })
  return NextResponse.json({ contribution: serializeContribution(updated), message: '投稿已更新' })
}

export async function DELETE(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { id } = await params
  const result = await prisma.concertContribution.updateMany({ where: { id, submitterId: guard.user.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } })
  if (result.count !== 1) return NextResponse.json({ message: '只有审核中的投稿可以撤回' }, { status: 409 })
  return NextResponse.json({ ok: true, message: '投稿已撤回' })
}
