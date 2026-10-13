import { NextResponse } from 'next/server'
import { rejectInvalidRequestOrigin, requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

// Protected legacy URL: forms collect information and have no review effects.
export async function PATCH(request: Request) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  return NextResponse.json({ code: 'FORM_REVIEW_DISABLED', message: '表单仅用于资料收集，请在活动帖评论旁审核参与内容' }, { status: 410 })
}
