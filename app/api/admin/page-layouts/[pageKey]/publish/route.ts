import { NextResponse } from 'next/server'
import {
  assertPageLayoutPageKey,
  pageLayoutErrorResponse,
  publishPageLayout,
} from '@/lib/page-layout/service'
import { requireAdmin } from '@/lib/security'

type Params = { params: Promise<{ pageKey: string }> }

export async function POST(request: Request, { params }: Params) {
  const guard = await requireAdmin('layout.publish')
  if (!guard.user) return guard.response

  try {
    const { pageKey } = await params
    const body = await request.json().catch(() => null)
    const version = Number(body?.version)
    if (!Number.isSafeInteger(version) || version < 1) {
      return NextResponse.json({ message: '布局版本不正确', code: 'INVALID_LAYOUT_VERSION' }, { status: 400 })
    }

    const layout = await publishPageLayout(assertPageLayoutPageKey(pageKey), version, guard.user.id, body?.config)
    return NextResponse.json({ ...layout, message: '布局已发布' })
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
