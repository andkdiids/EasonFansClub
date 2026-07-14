import { NextResponse } from 'next/server'
import {
  assertPageLayoutPageKey,
  getPageLayoutRevision,
  pageLayoutErrorResponse,
} from '@/lib/page-layout/service'
import { requireAdmin } from '@/lib/security'

type Params = { params: Promise<{ pageKey: string; revisionId: string }> }

export async function GET(_request: Request, { params }: Params) {
  const guard = await requireAdmin('layout.manage')
  if (!guard.user) return guard.response

  try {
    const { pageKey, revisionId } = await params
    const revision = await getPageLayoutRevision(assertPageLayoutPageKey(pageKey), revisionId)
    return NextResponse.json({ revision })
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
