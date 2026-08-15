import { NextResponse } from 'next/server'
import { ContributionAlreadyProcessedError, rejectConcertContribution } from '@/lib/music-contributions'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { id } = await params
  const body = await request.json().catch(() => null)
  const reviewNote = sanitizeText(body?.reviewNote ?? body?.reason, 2000)
  if (!reviewNote) return NextResponse.json({ message: '拒绝投稿时请填写拒绝原因' }, { status: 400 })
  try {
    const result = await rejectConcertContribution(id, guard.user.id, reviewNote)
    return NextResponse.json({ ok: true, result, message: '投稿已拒绝' })
  } catch (error) {
    if (error instanceof ContributionAlreadyProcessedError) return NextResponse.json({ message: '该投稿已经处理' }, { status: 409 })
    throw error
  }
}
