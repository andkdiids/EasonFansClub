import { NextResponse } from 'next/server'
import { getEasMusicAlbumLikeStates } from '@/lib/easmusic-likes'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { resolveRequestAuth } from '@/lib/security'

export const dynamic = 'force-dynamic'

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const page = positiveInt(params.get('page'), 1, 10_000)
  const pageSize = positiveInt(params.get('pageSize'), 24, 50)
  const featuredOnly = params.get('featured') === '1'
  const where = { status: 'PUBLISHED' as const, ...(featuredOnly ? { isFeatured: true } : {}) }
  const [total, albums] = await Promise.all([
    prisma.musicAlbum.count({ where }),
    prisma.musicAlbum.findMany({
      where,
      orderBy: featuredOnly
        ? [{ featuredOrder: 'asc' as const }, { displayOrder: 'asc' as const }, { releaseYear: 'desc' as const }]
        : [{ displayOrder: 'asc' as const }, { releaseYear: 'desc' as const }, { createdAt: 'desc' as const }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, artist: true, releaseYear: true, coverUrl: true, description: true,
        language: true, era: true, albumType: true, releaseDate: true, company: true, story: true,
        isFeatured: true, _count: { select: { MusicSong: true } },
      },
    }),
  ])
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const likeStates = await getEasMusicAlbumLikeStates(albums.map((album) => album.id), auth.user?.id)
  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    albums: albums.map(({ _count, ...album }) => ({
      ...album,
      coverUrl: toPublicMediaUrl(album.coverUrl),
      songCount: _count.MusicSong,
      ...(likeStates.get(album.id) || { liked: false, likeCount: 0 }),
    })),
  }, { headers: { 'Cache-Control': auth.user ? 'private, no-store' : 'public, max-age=60, s-maxage=120', Vary: 'Cookie, Authorization' } })
}
