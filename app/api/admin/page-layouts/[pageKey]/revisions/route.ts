import { NextResponse } from 'next/server'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import {
  assertPageLayoutPageKey,
  listPageLayoutRevisions,
  pageLayoutErrorResponse,
} from '@/lib/page-layout/service'
import { requireAdmin } from '@/lib/security'

type Params = { params: Promise<{ pageKey: string }> }

export async function GET(request: Request, { params }: Params) {
  const guard = await measureBootstrap('api.revisions.guard', requireAdmin('layout.manage'))
  if (!guard.user) return guard.response

  try {
    const { pageKey } = await params
    const url = new URL(request.url)
    const rawLimit = Number(url.searchParams.get('limit'))
    const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20))
    const revisions = await measureBootstrap('api.revisions.data', listPageLayoutRevisions(assertPageLayoutPageKey(pageKey), limit))
    return NextResponse.json({ revisions })
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
