import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ projectId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('studio_manage')
  if (!guard.user) return guard.response
  const { projectId } = await params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const artistId = body?.artistId === null || body?.artistId === '' ? null : typeof body?.artistId === 'string' ? body.artistId.trim() : undefined
  if (artistId === undefined) return NextResponse.json({ ok: false, message: '艺术家选择无效' }, { status: 400 })
  if (artistId) {
    const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { id: true } })
    if (!artist) return NextResponse.json({ ok: false, message: '艺术家不存在' }, { status: 404 })
  }
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ ok: false, message: '作品不存在' }, { status: 404 })
  const updated = await prisma.studioProject.update({ where: { id: projectId }, data: { artistId }, select: { id: true, artistId: true } })
  return NextResponse.json({ ok: true, project: updated })
}
