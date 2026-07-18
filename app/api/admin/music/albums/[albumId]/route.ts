import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { optionalMusicText, parseMusicYear } from '@/lib/music'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ albumId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const { albumId } = await params
  const body = await request.json().catch(() => null)
  const name = sanitizeText(body?.name, 160)
  const artist = sanitizeText(body?.artist, 100) || '陈奕迅'
  const releaseYear = parseMusicYear(body?.releaseYear)
  const language = sanitizeText(body?.language, 40) || '粤语'

  if (!name) return NextResponse.json({ message: '请填写专辑名称' }, { status: 400 })
  if (!releaseYear) return NextResponse.json({ message: '请填写有效发行年份' }, { status: 400 })

  try {
    const album = await prisma.musicAlbum.update({
      where: { id: albumId },
      data: {
        name,
        artist,
        releaseYear,
        language,
        coverUrl: optionalMusicText(body?.coverUrl, 1000),
        description: optionalMusicText(body?.description, 10000),
      },
      include: { songs: { orderBy: { trackNumber: 'asc' } } },
    })
    return NextResponse.json({ album, message: '专辑已保存' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ message: '专辑不存在' }, { status: 404 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '同名、同艺人和同年份的专辑已存在' }, { status: 409 })
    }
    throw error
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const { albumId } = await params
  try {
    await prisma.musicAlbum.delete({ where: { id: albumId } })
    return NextResponse.json({ ok: true, message: '专辑及其歌曲已删除' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ message: '专辑不存在' }, { status: 404 })
    }
    throw error
  }
}
