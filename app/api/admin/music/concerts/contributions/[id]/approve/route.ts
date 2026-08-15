import { NextResponse } from 'next/server'
import { ContributionAlreadyProcessedError, ContributionDuplicateError, ContributionValidationError, approveConcertContribution } from '@/lib/music-contributions'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { id } = await params
  const body = await request.json().catch(() => null)
  try {
    const result = await approveConcertContribution({ contributionId: id, reviewerId: guard.user.id, allowDuplicate: body?.allowDuplicate === true, payloadOverride: body?.payload })
    return NextResponse.json({ ok: true, result, message: '投稿已审核通过并进入正式资料' })
  } catch (error) {
    if (error instanceof ContributionAlreadyProcessedError) return NextResponse.json({ message: '该投稿已经处理' }, { status: 409 })
    if (error instanceof ContributionDuplicateError) return NextResponse.json({ code: 'POSSIBLE_DUPLICATE', message: error.message, duplicates: error.duplicates }, { status: 409 })
    if (error instanceof ContributionValidationError) return NextResponse.json({ message: error.message }, { status: 400 })
    throw error
  }
}
