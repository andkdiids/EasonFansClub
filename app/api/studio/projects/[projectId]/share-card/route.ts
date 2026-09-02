import { NextResponse } from 'next/server'
import { getOrCreatePublicShareCard, isValidShareCardContentId, ShareCardContentNotFoundError } from '@/lib/share-card-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RouteContext = { params: Promise<{ projectId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params
  if (!isValidShareCardContentId(projectId)) return NextResponse.json({ message: '项目标识无效' }, { status: 400 })
  try {
    const result = await getOrCreatePublicShareCard('studio', projectId)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof ShareCardContentNotFoundError) return NextResponse.json({ message: '作品不存在或暂不可公开分享' }, { status: 404 })
    console.error('[share-card.studio]', { projectId, errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '分享卡片暂时无法生成，请稍后重试' }, { status: 503 })
  }
}
