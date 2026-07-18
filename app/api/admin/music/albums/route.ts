import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { optionalMusicText, parseMusicYear } from '@/lib/music'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const name = sanitizeText(body?.name, 160)
  const artist = sanitizeText(body?.artist, 100) || '陈奕迅'
  const releaseYear = parseMusicYear(body?.releaseYear)
  const language = sanitizeText(body?.language, 40) || '粤语'

  if (!name) return NextResponse.json({ message: '请填写专辑名称' }, { status: 400 })
  if (!releaseYear) return NextResponse.json({ message: '请填写有效发行年份' }, { status: 400 })

  try {
    const album = await prisma.musicAlbum.create({
      data: {
        name,
        artist,
        releaseYear,
        language,
        coverUrl: optionalMusicText(body?.coverUrl, 1000),
        description: optionalMusicText(body?.description, 10000),
      },
      include: { songs: true },
    })
    return NextResponse.json({ album, message: '专辑已创建' }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '同名、同艺人和同年份的专辑已存在' }, { status: 409 })
    }
    throw error
  }
}
