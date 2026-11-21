import { NextResponse } from 'next/server'
import { generateMemoir, readMemoir } from '@/lib/annual-memoir-report'
import { getCurrentUser } from '@/lib/auth'
import { hasValidRequestOrigin } from '@/lib/security'

type Context = { params: Promise<{ activityId: string }> }
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { headers, status: 401 })
  const snapshot = await readMemoir((await params).activityId, user.id)
  return NextResponse.json({ snapshot }, { headers })
}

export async function POST(request: Request, { params }: Context) {
  if (!hasValidRequestOrigin(request)) return NextResponse.json({ code: 'FORBIDDEN' }, { headers, status: 403 })
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { headers, status: 401 })
  const body = await request.json().catch(() => null)
  if (body?.confirmed !== true) return NextResponse.json({ code: 'CONFIRMATION_REQUIRED' }, { headers, status: 400 })
  const snapshot = await generateMemoir((await params).activityId, user.id)
  if (!snapshot) return NextResponse.json({ code: 'REPORT_UNAVAILABLE' }, { headers, status: 409 })
  return NextResponse.json({ snapshot }, { headers })
}
