import { NextResponse } from 'next/server'
import {
  assertPageLayoutPageKey,
  getPublishedPageLayoutConfig,
  pageLayoutErrorResponse,
} from '@/lib/page-layout/service'

type Params = { params: Promise<{ pageKey: string }> }

export async function GET(_request: Request, { params }: Params) {
  try {
    const { pageKey } = await params
    const safePageKey = assertPageLayoutPageKey(pageKey)
    return NextResponse.json({
      pageKey: safePageKey,
      publishedConfig: await getPublishedPageLayoutConfig(safePageKey),
    })
  } catch (error) {
    const { status, body } = pageLayoutErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
