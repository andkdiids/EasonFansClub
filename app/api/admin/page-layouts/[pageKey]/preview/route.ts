import { NextResponse } from 'next/server'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import { assertPageLayoutPageKey, pageLayoutErrorResponse } from '@/lib/page-layout/service'
import { getPageLayoutPreviewData } from '@/lib/page-layout/preview-data'
import { requireAdmin } from '@/lib/security'

type Params = { params: Promise<{ pageKey: string }> }

export async function GET(_request: Request, { params }: Params) {
  const guard = await measureBootstrap('api.preview.guard', requireAdmin('layout.manage'))
  if (!guard.user) return guard.response

  try {
    const { pageKey } = await params
    const preview = await measureBootstrap('api.preview.data', getPageLayoutPreviewData(assertPageLayoutPageKey(pageKey), guard.user))
    return NextResponse.json(preview)
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
