import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { publicImageUrl, storedImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { normalizeArtistSlug } from '@/lib/studio/artists'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ artistId: string }> }

function artistView(artist: { id: string; slug: string; name: string; avatar: string | null; description: string | null; createdAt: Date; updatedAt: Date }) {
  return { ...artist, avatar: publicImageUrl(artist.avatar), createdAt: artist.createdAt.toISOString(), updatedAt: artist.updatedAt.toISOString() }
}

export async function PATCH(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('studio_manage')
  if (!guard.user) return guard.response
  const { artistId } = await params
  const current = await prisma.artist.findUnique({ where: { id: artistId } })
  if (!current) return NextResponse.json({ ok: false, message: '艺术家不存在' }, { status: 404 })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const slug = normalizeArtistSlug(body?.slug)
  const name = sanitizeText(body?.name, 160)
  if (!slug) return NextResponse.json({ ok: false, message: '请输入有效的艺术家 slug' }, { status: 400 })
  if (!name) return NextResponse.json({ ok: false, message: '请填写艺术家名称' }, { status: 400 })
  try {
    const artist = await prisma.artist.update({
      where: { id: artistId },
      data: {
        slug,
        name,
        avatar: storedImageUrl(sanitizeText(body?.avatar, 1000)),
        description: sanitizeText(body?.description, 4000) || null,
      },
    })
    return NextResponse.json({ ok: true, artist: artistView(artist) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ ok: false, message: '该 slug 已存在' }, { status: 409 })
    throw error
  }
}
