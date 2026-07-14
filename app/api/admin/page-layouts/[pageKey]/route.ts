import { NextResponse } from 'next/server'
import {
  assertPageLayoutPageKey,
  getAdminPageLayout,
  pageLayoutErrorResponse,
} from '@/lib/page-layout/service'
import { requireAdmin } from '@/lib/security'

type Params = { params: Promise<{ pageKey: string }> }

export async function GET(_request: Request, { params }: Params) {
  const guard = await requireAdmin('layout.manage')
  if (!guard.user) return guard.response

  try {
    const { pageKey } = await params
    return NextResponse.json(await getAdminPageLayout(assertPageLayoutPageKey(pageKey)))
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
