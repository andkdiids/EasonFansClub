import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { optionalMusicText, parseMusicFeatured, parseMusicFeaturedOrder, parseMusicYear } from '@/lib/music'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { deleteGuessSongObjects } from '@/lib/guess-song-storage'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ albumId: string }> }

function parseReleaseDate(value: unknown) {
  const raw = sanitizeText(value, 20)
  if (!raw) return null
  const date = new Date(`${raw}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { albumId } = await params
  const album = await prisma.musicAlbum.findUnique({
    where: { id: albumId },
    include: { MusicSong: { orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }] } },
  })
  if (!album) return NextResponse.json({ message: '专辑不存在' }, { status: 404 })
  const { MusicSong, ...albumData } = album
  return NextResponse.json({ album: {
    ...albumData,
    coverUrl: toPublicMediaUrl(albumData.coverUrl),
    songs: MusicSong.map((song) => ({ ...song, coverUrl: toPublicMediaUrl(song.coverUrl), previewUrl: toPublicMediaUrl(song.previewUrl) })),
  } })
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const { albumId } = await params
  const body = await request.json().catch(() => null)
  const current = await prisma.musicAlbum.findUnique({ where: { id: albumId }, select: { id: true, coverUrl: true } })
  if (!current) return NextResponse.json({ message: '专辑不存在' }, { status: 404 })

  const name = sanitizeText(body?.albumName ?? body?.name, 160)
  const releaseYear = parseMusicYear(body?.releaseYear)
  const releaseDate = parseReleaseDate(body?.releaseDate)
  const requestedStatus = body?.status === 'PUBLISHED' || body?.status === 'published' ? 'PUBLISHED' : 'DRAFT'
  const displayOrder = Number.isInteger(Number(body?.displayOrder)) ? Math.max(0, Number(body.displayOrder)) : 0
  const isFeatured = parseMusicFeatured(body?.isFeatured)
  const featuredOrder = parseMusicFeaturedOrder(body?.featuredOrder, isFeatured)
  if (!name) return NextResponse.json({ message: '请填写专辑名称' }, { status: 400 })
  if (!releaseYear) return NextResponse.json({ message: '请填写有效发行年份' }, { status: 400 })
  if (releaseDate === undefined) return NextResponse.json({ message: '请填写有效发行日期' }, { status: 400 })
  if (requestedStatus === 'PUBLISHED' && !current.coverUrl) return NextResponse.json({ message: '发布前请先上传专辑封面' }, { status: 400 })

  try {
    const album = await prisma.musicAlbum.update({
      where: { id: albumId },
      data: {
        name,
        artist: sanitizeText(body?.artist, 100) || '陈奕迅',
        releaseDate,
        releaseYear,
        language: sanitizeText(body?.language, 40) || '粤语',
        company: optionalMusicText(body?.company, 200),
        description: optionalMusicText(body?.description, 10000),
        story: optionalMusicText(body?.story, 20000),
        displayOrder,
        isFeatured,
        featuredOrder,
        status: requestedStatus,
      },
      include: { MusicSong: { orderBy: { trackNumber: 'asc' } } },
    })
    const { MusicSong, ...albumData } = album
    return NextResponse.json({ album: {
      ...albumData,
      coverUrl: toPublicMediaUrl(albumData.coverUrl),
      songs: MusicSong.map((song) => ({ ...song, coverUrl: toPublicMediaUrl(song.coverUrl), previewUrl: toPublicMediaUrl(song.previewUrl) })),
    }, message: requestedStatus === 'PUBLISHED' ? '专辑已发布' : '专辑草稿已保存' })
  } catch (error) {
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
    const sources = await prisma.musicSong.findMany({
      where: { albumId, sourceAudioPath: { not: null } },
      select: { sourceAudioPath: true },
    })
    await prisma.musicAlbum.delete({ where: { id: albumId } })
    await deleteGuessSongObjects(
      sources.flatMap((song) => song.sourceAudioPath ? [song.sourceAudioPath] : []),
    ).catch((error) => {
      console.error('[music-album.delete-sources]', error)
    })
    return NextResponse.json({ ok: true, message: '专辑及其歌曲已删除' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ message: '专辑不存在' }, { status: 404 })
    throw error
  }
}
