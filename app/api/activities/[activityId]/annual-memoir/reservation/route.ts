import { NextResponse } from 'next/server'
import { getMemoirReservation, reserveMemoir } from '@/lib/annual-memoir-reservation'
import { getCurrentUser } from '@/lib/auth'
import { hasValidRequestOrigin } from '@/lib/security'

type Context = { params: Promise<{ activityId: string }> }

function respond(reservation: Awaited<ReturnType<typeof getMemoirReservation>>) {
  return NextResponse.json({ reservation: reservation && {
    createdAt: reservation.createdAt,
    points: reservation.points,
    badgeId: reservation.badgeId,
    pointsGrantedAt: reservation.pointsGrantedAt,
    badgeGrantedAt: reservation.badgeGrantedAt,
  } }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 })
  return respond(await getMemoirReservation((await params).activityId, user.id))
}

export async function POST(request: Request, { params }: Context) {
  if (!hasValidRequestOrigin(request)) return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 })
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (body?.confirmed !== true) return NextResponse.json({ code: 'CONFIRMATION_REQUIRED' }, { status: 400 })
  const reservation = await reserveMemoir((await params).activityId, user.id)
  if (!reservation) return NextResponse.json({ code: 'RESERVATION_UNAVAILABLE' }, { status: 409 })
  return respond(reservation)
}
