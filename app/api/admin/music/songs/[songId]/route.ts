import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { optionalMusicText, parseMusicYear, parseOptionalDuration, parseTrackNumber } from '@/lib/music'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ songId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { songId } = await params
  const body = await request.json().catch(() => null)
  const albumId = sanitizeText(body?.albumId, 100)
  const title = sanitizeText(body?.songName ?? body?.title, 160)
  const trackNumber = parseTrackNumber(body?.trackNumber)
  const album = albumId ? await prisma.musicAlbum.findUnique({ where: { id: albumId }, select: { artist: true, releaseYear: true } }) : null
  if (!album) return NextResponse.json({ message: '请选择有效专辑' }, { status: 400 })
  if (!title) return NextResponse.json({ message: '请填写歌曲名称' }, { status: 400 })
  if (!trackNumber) return NextResponse.json({ message: '请填写有效曲序' }, { status: 400 })

  try {
    const song = await prisma.musicSong.update({
      where: { id: songId },
      data: {
        title,
        albumId,
        trackNumber,
        artist: sanitizeText(body?.artist, 100) || album.artist,
        releaseYear: parseMusicYear(body?.releaseYear) || album.releaseYear,
        duration: parseOptionalDuration(body?.duration),
        language: optionalMusicText(body?.language, 40),
        composer: optionalMusicText(body?.composer, 200),
        lyricist: optionalMusicText(body?.lyricist, 200),
        arranger: optionalMusicText(body?.arranger, 200),
        producer: optionalMusicText(body?.producer, 200),
        description: optionalMusicText(body?.description, 10000),
        story: optionalMusicText(body?.story, 20000),
        lyrics: optionalMusicText(body?.lyrics, 50000),
        tags: optionalMusicText(body?.tags, 2000),
        mood: optionalMusicText(body?.mood, 200),
        scene: optionalMusicText(body?.scene, 200),
        concertVersion: optionalMusicText(body?.concertVersion, 200),
      },
      include: { MusicAlbum: true },
    })
    const { MusicAlbum, ...songData } = song
    return NextResponse.json({ song: { ...songData, album: MusicAlbum }, message: '歌曲已保存' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ message: '歌曲不存在' }, { status: 404 })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ message: '该专辑中已存在相同曲序或歌曲名称' }, { status: 409 })
    throw error
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { songId } = await params
  try {
    await prisma.musicSong.delete({ where: { id: songId } })
    return NextResponse.json({ ok: true, message: '歌曲已删除' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ message: '歌曲不存在' }, { status: 404 })
    throw error
  }
}
