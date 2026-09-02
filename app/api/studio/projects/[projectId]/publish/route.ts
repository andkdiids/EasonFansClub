import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { projectId } = await context.params
  const project = await prisma.studioProject.findFirst({ where: { id: projectId, userId: guard.user.id }, select: { id: true, visibility: true, reviewStatus: true } })
  if (!project) return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
  if (project.visibility === 'PUBLIC' && project.reviewStatus === 'APPROVED') {
    return NextResponse.json({ ok: true, visibility: project.visibility, reviewStatus: project.reviewStatus, message: '作品已经通过公开审核' })
  }
  const updated = await prisma.studioProject.update({
    where: { id: project.id },
    data: { visibility: 'PUBLIC', reviewStatus: 'PENDING' },
    select: { id: true, visibility: true, reviewStatus: true },
  })
  return NextResponse.json({ ok: true, visibility: updated.visibility, reviewStatus: updated.reviewStatus, message: '已提交公开审核，审核通过后即可分享' })
}
