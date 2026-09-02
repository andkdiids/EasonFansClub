import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { isValidStudioProjectId, PUBLIC_STUDIO_PROJECT_WHERE } from '@/lib/studio/public'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

/** Count only an explicit download request; viewing a project never reaches this route. */
export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const limited = await enforceApiRateLimit(request, null, {
    endpoint: '/api/studio/projects/download',
    ip: { limit: 30, windowSeconds: 60 },
  }, '下载请求过于频繁，请稍后再试')
  if (limited) return limited

  const { projectId } = await context.params
  if (!isValidStudioProjectId(projectId)) return NextResponse.json({ ok: false, message: '项目标识无效' }, { status: 400 })

  const updated = await prisma.studioProject.updateMany({
    where: { ...PUBLIC_STUDIO_PROJECT_WHERE, id: projectId },
    data: { downloadCount: { increment: 1 } },
  })
  if (!updated.count) return NextResponse.json({ ok: false, message: '作品不存在或暂不公开' }, { status: 404 })

  const project = await prisma.studioProject.findFirst({
    where: { ...PUBLIC_STUDIO_PROJECT_WHERE, id: projectId },
    select: { downloadCount: true },
  })
  return NextResponse.json({ ok: true, downloadCount: project?.downloadCount ?? 0 }, { headers: { 'Cache-Control': 'no-store' } })
}
