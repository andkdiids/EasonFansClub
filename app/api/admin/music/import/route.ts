import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import {
  MUSIC_IMPORT_MAX_FILE_SIZE,
  normalizeMusicImportKey,
  parseMusicImportWorkbook,
  type MusicImportFailure,
  type MusicSongImportRow,
} from '@/lib/music-import'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ImportResult = {
  committed: boolean
  addedAlbums: number
  addedSongs: number
  skippedAlbums: number
  skippedSongs: number
  failedRows: number
  failures: MusicImportFailure[]
  ignoredSheets: string[]
}

class MusicImportValidationError extends Error {
  constructor(public failures: MusicImportFailure[]) {
    super('音乐数据校验失败')
  }
}

function emptyResult(failures: MusicImportFailure[] = [], ignoredSheets: string[] = []): ImportResult {
  return { committed: false, addedAlbums: 0, addedSongs: 0, skippedAlbums: 0, skippedSongs: 0, failedRows: failures.length, failures, ignoredSheets }
}

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择要导入的文件', result: emptyResult() }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ message: '导入文件不能为空', result: emptyResult() }, { status: 400 })
  if (file.size > MUSIC_IMPORT_MAX_FILE_SIZE) return NextResponse.json({ message: '导入文件不能超过 10MB', result: emptyResult() }, { status: 400 })

  let parsed
  try {
    parsed = parseMusicImportWorkbook(file.name, await file.arrayBuffer())
  } catch (error) {
    const failure = { sheet: '文件', row: 1, reason: error instanceof Error ? error.message : '文件解析失败' }
    return NextResponse.json({ message: '文件解析失败，未写入任何数据', result: emptyResult([failure]) }, { status: 400 })
  }

  if (parsed.failures.length > 0) {
    return NextResponse.json({ message: '数据校验失败，整批未写入', result: emptyResult(parsed.failures, parsed.ignoredSheets) }, { status: 400 })
  }
  if (parsed.albums.length === 0 && parsed.songs.length === 0) {
    const failure = { sheet: '文件', row: 1, reason: '没有可导入的专辑或歌曲数据' }
    return NextResponse.json({ message: failure.reason, result: emptyResult([failure], parsed.ignoredSheets) }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingAlbums = await tx.musicAlbum.findMany({
        orderBy: { createdAt: 'asc' },
        include: { songs: { select: { title: true, trackNumber: true } } },
      })
      const albumTargets = new Map<string, {
        id?: string
        artist: string
        row?: (typeof parsed.albums)[number]
        titles: Set<string>
        tracks: Map<number, string>
      }>()

      existingAlbums.forEach((album) => {
        const key = normalizeMusicImportKey(album.name)
        if (albumTargets.has(key)) return
        albumTargets.set(key, {
          id: album.id,
          artist: album.artist,
          titles: new Set(album.songs.map((song) => normalizeMusicImportKey(song.title))),
          tracks: new Map(album.songs.map((song) => [song.trackNumber, normalizeMusicImportKey(song.title)])),
        })
      })

      let skippedAlbums = 0
      const albumsToCreate: (typeof parsed.albums)[number][] = []
      parsed.albums.forEach((album) => {
        const key = normalizeMusicImportKey(album.name)
        if (albumTargets.has(key)) {
          skippedAlbums += 1
          return
        }
        albumsToCreate.push(album)
        albumTargets.set(key, { artist: album.artist, row: album, titles: new Set(), tracks: new Map() })
      })

      let skippedSongs = 0
      const songsToCreate: Array<{ song: MusicSongImportRow; albumKey: string }> = []
      const failures: MusicImportFailure[] = []
      parsed.songs.forEach((song) => {
        const albumKey = normalizeMusicImportKey(song.albumName)
        const target = albumTargets.get(albumKey)
        if (!target) {
          failures.push({ sheet: 'Songs', row: song.row, reason: `找不到所属专辑：${song.albumName}` })
          return
        }
        const titleKey = normalizeMusicImportKey(song.title)
        if (target.titles.has(titleKey)) {
          skippedSongs += 1
          return
        }
        const occupiedTitle = target.tracks.get(song.trackNumber)
        if (occupiedTitle && occupiedTitle !== titleKey) {
          failures.push({ sheet: 'Songs', row: song.row, reason: `专辑《${song.albumName}》的曲序 ${song.trackNumber} 已被其他歌曲占用` })
          return
        }
        target.titles.add(titleKey)
        target.tracks.set(song.trackNumber, titleKey)
        songsToCreate.push({ song, albumKey })
      })

      if (failures.length > 0) throw new MusicImportValidationError(failures)

      for (const album of albumsToCreate) {
        const created = await tx.musicAlbum.create({
          data: {
            name: album.name,
            artist: album.artist,
            releaseYear: album.releaseYear,
            language: album.language,
            coverUrl: album.coverUrl,
            description: album.description,
            era: album.era,
            albumType: album.albumType,
          },
          select: { id: true },
        })
        const target = albumTargets.get(normalizeMusicImportKey(album.name))
        if (target) target.id = created.id
      }

      if (songsToCreate.length > 0) {
        await tx.musicSong.createMany({
          data: songsToCreate.map(({ song, albumKey }) => {
            const target = albumTargets.get(albumKey)
            if (!target?.id) throw new MusicImportValidationError([{ sheet: 'Songs', row: song.row, reason: `无法关联所属专辑：${song.albumName}` }])
            return {
              title: song.title,
              artist: target.artist,
              albumId: target.id,
              trackNumber: song.trackNumber,
              releaseYear: song.releaseYear,
              language: song.language,
              lyricist: song.lyricist,
              composer: song.composer,
              arranger: song.arranger,
              producer: song.producer,
              story: song.story,
              tags: song.tags,
              era: song.era,
              trackType: song.trackType,
              concertVersion: song.concertVersion,
              mood: song.mood,
              scene: song.scene,
              recommendLevel: song.recommendLevel,
            }
          }),
        })
      }

      return {
        committed: true,
        addedAlbums: albumsToCreate.length,
        addedSongs: songsToCreate.length,
        skippedAlbums,
        skippedSongs,
        failedRows: 0,
        failures: [],
        ignoredSheets: parsed.ignoredSheets,
      } satisfies ImportResult
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })

    return NextResponse.json({ message: 'EasMusic 数据导入完成', result })
  } catch (error) {
    if (error instanceof MusicImportValidationError) {
      return NextResponse.json({ message: '数据校验失败，事务已回滚', result: emptyResult(error.failures, parsed.ignoredSheets) }, { status: 400 })
    }
    const reason = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
      ? '导入期间检测到并发重复数据，事务已回滚，请重新导入'
      : '数据库写入失败，事务已回滚'
    console.error('[admin.music.import]', error)
    return NextResponse.json({ message: reason, result: emptyResult([{ sheet: '数据库', row: 0, reason }], parsed.ignoredSheets) }, { status: 500 })
  }
}
