import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

function projectMetadata(data: Prisma.JsonValue) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const pattern = (data as Record<string, unknown>).pattern
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return undefined
  const row = pattern as Record<string, unknown>
  const cells = Array.isArray(row.cells) ? row.cells : []
  return {
    width: typeof row.width === 'number' ? row.width : undefined,
    height: typeof row.height === 'number' ? row.height : undefined,
    totalBeads: cells.filter((cell) => typeof cell === 'number' && cell >= 0).length,
    colorCount: new Set(cells.filter((cell): cell is number => typeof cell === 'number' && cell >= 0)).size,
  }
}

function projectView(project: { id: string; toolSlug: string; title: string; description: string | null; version: number; data: Prisma.JsonValue; thumbnailUrl: string | null; likeCount: number; favoriteCount: number; viewCount: number; visibility: string; reviewStatus: string; createdAt: Date; updatedAt: Date; lastOpenedAt: Date | null }) {
  return {
    id: project.id,
    toolSlug: project.toolSlug,
    title: project.title,
    description: project.description,
    version: project.version,
    data: project.data,
    thumbnailUrl: project.thumbnailUrl,
    likeCount: project.likeCount,
    favoriteCount: project.favoriteCount,
    viewCount: project.viewCount,
    visibility: project.visibility,
    reviewStatus: project.reviewStatus,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    lastOpenedAt: project.lastOpenedAt?.toISOString() || null,
    metadata: projectMetadata(project.data),
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { projectId } = await context.params
  const project = await prisma.studioProject.findFirst({ where: { id: projectId, userId: guard.user.id } })
  if (!project) return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
  return NextResponse.json({ ok: true, project: projectView(project) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(_request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { projectId } = await context.params
  const existing = await prisma.studioProject.findFirst({ where: { id: projectId, userId: guard.user.id }, select: { id: true } })
  if (!existing) return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
  await prisma.studioProject.delete({ where: { id: existing.id } })
  return NextResponse.json({ ok: true })
}
