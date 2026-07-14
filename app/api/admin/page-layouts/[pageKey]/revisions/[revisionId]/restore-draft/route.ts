import { NextResponse } from 'next/server'
import {
  assertPageLayoutPageKey,
  pageLayoutErrorResponse,
  restorePageLayoutRevisionToDraft,
} from '@/lib/page-layout/service'
import { requireAdmin } from '@/lib/security'

type Params = { params: Promise<{ pageKey: string; revisionId: string }> }

export async function POST(request: Request, { params }: Params) {
  const guard = await requireAdmin('layout.manage')
  if (!guard.user) return guard.response

  try {
    const { pageKey, revisionId } = await params
    const body = await request.json().catch(() => null)
    const version = Number(body?.version)
    if (!Number.isSafeInteger(version) || version < 1) {
      return NextResponse.json({ message: '布局版本不正确', code: 'INVALID_LAYOUT_VERSION' }, { status: 400 })
    }

    const layout = await restorePageLayoutRevisionToDraft(assertPageLayoutPageKey(pageKey), revisionId, version, guard.user.id)
    return NextResponse.json({ ...layout, message: '历史版本已恢复为草稿' })
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
