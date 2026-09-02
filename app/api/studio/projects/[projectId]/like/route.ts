import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, unauthenticatedResponse } from '@/lib/security'
import { setStudioProjectInteraction } from '@/lib/studio/interactions'
import { isValidStudioProjectId } from '@/lib/studio/public'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

async function handle(request: Request, context: RouteContext, active: boolean) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录后再点赞')
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/studio/projects/like',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited
  const { projectId } = await context.params
  if (!isValidStudioProjectId(projectId)) return NextResponse.json({ ok: false, message: '项目标识无效' }, { status: 400 })
  const state = await setStudioProjectInteraction({ projectId, userId: user.id, kind: 'like', active })
  if (!state) return NextResponse.json({ ok: false, message: '作品不存在或暂不公开' }, { status: 404 })
  return NextResponse.json({ ok: true, ...state })
}

export async function POST(request: Request, context: RouteContext) { return handle(request, context, true) }
export async function DELETE(request: Request, context: RouteContext) { return handle(request, context, false) }
