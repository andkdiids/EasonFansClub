import { NextResponse } from 'next/server'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const kind = params.get('kind')
  const query = sanitizeText(params.get('q'), 80)
  if (kind === 'badges') {
    const badges = await prisma.badge.findMany({ where: { isEnabled: true, ...(query ? { OR: [{ name: { contains: query } }, { code: { contains: query } }] } : {}) }, orderBy: { name: 'asc' }, take: 100, select: { id: true, name: true, iconUrl: true } })
    return NextResponse.json({ options: badges.map((badge) => ({ id: badge.id, label: badge.name, imageUrl: badge.iconUrl })) })
  }
  if (kind === 'concerts') {
    const concerts = await prisma.musicConcert.findMany({ where: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' }, ...(query ? { OR: [{ title: { contains: query } }, { city: { contains: query } }, { venue: { contains: query } }, { MusicTour: { name: { contains: query } } }] } : {}) }, orderBy: [{ concertDate: 'desc' }, { city: 'asc' }], take: 100, select: { id: true, title: true, city: true, venue: true, concertDate: true, sessionNumber: true, MusicTour: { select: { name: true } } } })
    return NextResponse.json({ options: concerts.map((concert) => ({ id: concert.id, label: `${concert.MusicTour.name} · ${concert.city}${concert.venue ? ` · ${concert.venue}` : ''} · ${concert.concertDate.toISOString().slice(0, 10)}${concert.sessionNumber ? ` · ${concert.sessionNumber}` : ''}`, title: concert.title })) })
  }
  if (kind === 'users') {
    const uid = Number(query)
    const users = await prisma.user.findMany({ where: { status: 'ACTIVE', isDeleted: false, ...(query ? { OR: [{ nickname: { contains: query } }, { username: { contains: query } }, ...(Number.isSafeInteger(uid) ? [{ uid }] : [])] } : {}) }, orderBy: { uid: 'asc' }, take: 30, select: { id: true, uid: true, nickname: true, username: true } })
    return NextResponse.json({ options: users.map((user) => ({ id: user.id, label: `${user.nickname || 'E院用户'} · E院ID ${user.uid}`, username: user.username, uid: user.uid })) })
  }
  if (kind === 'activities') {
    const activities = await prisma.activity.findMany({
      where: {
        status: { not: 'CANCELLED' },
        ...(query ? { OR: [{ title: { contains: query } }, { subtitle: { contains: query } }] } : {}),
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: { id: true, title: true, startsAt: true, endsAt: true, status: true },
    })
    return NextResponse.json({ options: activities.map((activity) => ({ id: activity.id, label: `${activity.title}${activity.startsAt ? ` · ${activity.startsAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` : ''}`, title: activity.title, startsAt: activity.startsAt?.toISOString() || null, endsAt: activity.endsAt?.toISOString() || null, status: activity.status })) })
  }
  return NextResponse.json({ options: [] })
}
