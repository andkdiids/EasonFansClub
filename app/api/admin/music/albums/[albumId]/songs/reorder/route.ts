import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function PATCH(request: Request, { params }: { params: Promise<{ albumId: string }> }) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { albumId } = await params
  const body = await request.json().catch(() => null)
  const songIds = Array.isArray(body?.songIds) ? body.songIds.map((value: unknown) => sanitizeText(value, 100)).filter(Boolean) : []
  const current = await prisma.musicSong.findMany({ where: { albumId }, select: { id: true } })
  if (songIds.length !== current.length || new Set(songIds).size !== songIds.length || current.some((song) => !songIds.includes(song.id))) {
    return NextResponse.json({ message: '歌曲排序数据不完整' }, { status: 400 })
  }
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < songIds.length; index += 1) await tx.musicSong.update({ where: { id: songIds[index] }, data: { trackNumber: -(index + 1) } })
    for (let index = 0; index < songIds.length; index += 1) await tx.musicSong.update({ where: { id: songIds[index] }, data: { trackNumber: index + 1 } })
  })
  return NextResponse.json({ ok: true, message: '歌曲排序已保存' })
}
