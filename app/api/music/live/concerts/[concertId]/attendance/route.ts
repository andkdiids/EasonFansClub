import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { parseAttendanceInput, parseAttendanceVersion, PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { prisma } from '@/lib/prisma'
import { checkConcertBadge } from '@/lib/concert-badge'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { deleteFromCos, describeCosError } from '@/lib/tencent-cos'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ concertId: string }> }

async function findPublishedConcert(concertId: string) {
  return prisma.musicConcert.findFirst({
    where: { id: concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
    select: { id: true },
  })
}

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const { concertId } = await params
  const attendance = await prisma.userMusicConcert.findUnique({
    where: { userId_concertId: { userId: guard.user.id, concertId } },
    select: { id: true, seatInfo: true, mood: true, note: true, isPublic: true, createdAt: true, updatedAt: true },
  })
  return NextResponse.json({ attendance }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}

export async function POST(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return withPersonalNoStore(originError)
  const { concertId } = await params
  if (!await findPublishedConcert(concertId)) {
    return NextResponse.json({ message: '演唱会场次不存在或暂未公开' }, { status: 404, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }
  const parsed = parseAttendanceInput(await request.json().catch(() => null))
  if (!parsed.data) return NextResponse.json({ message: parsed.message }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  try {
    const attendance = await prisma.userMusicConcert.create({
      data: { userId: guard.user.id, concertId, ...parsed.data },
      select: { id: true, seatInfo: true, mood: true, note: true, isPublic: true, createdAt: true, updatedAt: true },
    })
    // 自动授予演唱会纪念徽章：失败绝不能影响「加入我的现场」主流程。
    try {
      await checkConcertBadge(guard.user.id, concertId)
    } catch (error) {
      console.error('[attendance.concertBadge]', error)
    }
    triggerBadgeEvaluation(guard.user.id, 'CONCERT_ATTENDANCE_CREATED')
    return NextResponse.json({ attendance, message: '已加入我的现场' }, { status: 201, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '这场演唱会已经在你的现场记录中' }, { status: 409, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
    }
    throw error
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return withPersonalNoStore(originError)
  const { concertId } = await params
  const body = await request.json().catch(() => null)
  const parsed = parseAttendanceInput(body)
  if (!parsed.data) return NextResponse.json({ message: parsed.message }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  const expectedUpdatedAt = parseAttendanceVersion(body?.updatedAt)
  if (expectedUpdatedAt === undefined) {
    return NextResponse.json({ message: '观演记录版本格式不正确' }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }
  const result = await prisma.userMusicConcert.updateMany({
    where: { userId: guard.user.id, concertId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    data: parsed.data,
  })
  if (!result.count) {
    const exists = await prisma.userMusicConcert.count({ where: { userId: guard.user.id, concertId } })
    return NextResponse.json(
      { message: exists ? '观演记录已在其他页面更新，请刷新后重试' : '观演记录不存在' },
      { status: exists ? 409 : 404, headers: PERSONAL_LIVE_NO_STORE_HEADERS },
    )
  }
  const attendance = await prisma.userMusicConcert.findUnique({
    where: { userId_concertId: { userId: guard.user.id, concertId } },
    select: { id: true, seatInfo: true, mood: true, note: true, isPublic: true, createdAt: true, updatedAt: true },
  })
  return NextResponse.json({ attendance, message: '观演记录已更新' }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return withPersonalNoStore(originError)
  const { concertId } = await params
  const deleted = await prisma.$transaction(async (tx) => {
    const attendanceRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM UserMusicConcert
      WHERE userId = ${guard.user.id} AND concertId = ${concertId}
      LIMIT 1
      FOR UPDATE
    `
    const attendanceId = attendanceRows[0]?.id
    if (!attendanceId) return { count: 0, storageKeys: [] as string[] }
    const photos = await tx.myLivePhoto.findMany({ where: { attendanceId, userId: guard.user.id }, select: { storageKey: true } })
    const result = await tx.userMusicConcert.deleteMany({
      where: { userId: guard.user.id, concertId },
    })
    return { count: result.count, storageKeys: photos.map((photo) => photo.storageKey) }
  })
  if (!deleted.count) return NextResponse.json({ message: '观演记录不存在' }, { status: 404, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  await Promise.all(deleted.storageKeys.map(async (storageKey) => {
    try {
      await deleteFromCos(storageKey)
    } catch (error) {
      console.error('[attendance.delete.photo.cos]', { storageKey, error: describeCosError(error) })
    }
  }))
  return NextResponse.json({ ok: true, message: '已从我的现场移除' }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}
