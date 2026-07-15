import { NextResponse } from 'next/server'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import {
  assertPageLayoutPageKey,
  getAdminPageLayout,
  pageLayoutErrorResponse,
} from '@/lib/page-layout/service'
import { requireAdmin } from '@/lib/security'

type Params = { params: Promise<{ pageKey: string }> }

export async function GET(_request: Request, { params }: Params) {
  const guard = await measureBootstrap('api.layout.guard', requireAdmin('layout.manage'))
  if (!guard.user) return guard.response

  try {
    const { pageKey } = await params
    const layout = await measureBootstrap('api.layout.data', getAdminPageLayout(assertPageLayoutPageKey(pageKey)))
    return NextResponse.json(layout)
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
