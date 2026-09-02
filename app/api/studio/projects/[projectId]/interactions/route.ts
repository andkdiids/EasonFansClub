import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getStudioProjectInteractionState } from '@/lib/studio/interactions'
import { isValidStudioProjectId } from '@/lib/studio/public'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params
  if (!isValidStudioProjectId(projectId)) return NextResponse.json({ ok: false, message: '项目标识无效' }, { status: 400 })
  const viewer = await getCurrentUser().catch(() => null)
  const state = await getStudioProjectInteractionState(projectId, viewer?.id)
  if (!state) return NextResponse.json({ ok: false, message: '作品不存在或暂不公开' }, { status: 404 })
  return NextResponse.json({ ok: true, ...state }, { headers: { 'Cache-Control': viewer ? 'private, no-store' : 'public, max-age=30' } })
}
