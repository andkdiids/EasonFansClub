import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { publicImageUrl, storedImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { normalizeArtistSlug } from '@/lib/studio/artists'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

function artistView(artist: { id: string; slug: string; name: string; avatar: string | null; description: string | null; createdAt: Date; updatedAt: Date }) {
  return { ...artist, avatar: publicImageUrl(artist.avatar), createdAt: artist.createdAt.toISOString(), updatedAt: artist.updatedAt.toISOString() }
}

export async function GET() {
  const guard = await requireAdmin('studio_manage')
  if (!guard.user) return guard.response
  const artists = await prisma.artist.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 200 })
  return NextResponse.json({ artists: artists.map(artistView) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('studio_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const slug = normalizeArtistSlug(body?.slug)
  const name = sanitizeText(body?.name, 160)
  if (!slug) return NextResponse.json({ ok: false, message: '请输入小写字母、数字或短横线组成的 slug' }, { status: 400 })
  if (!name) return NextResponse.json({ ok: false, message: '请填写艺术家名称' }, { status: 400 })
  try {
    const artist = await prisma.artist.create({
      data: {
        slug,
        name,
        avatar: storedImageUrl(sanitizeText(body?.avatar, 1000)),
        description: sanitizeText(body?.description, 4000) || null,
      },
    })
    return NextResponse.json({ ok: true, artist: artistView(artist) }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ ok: false, message: '该 slug 已存在' }, { status: 409 })
    throw error
  }
}
