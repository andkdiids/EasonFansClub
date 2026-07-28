import { NextResponse } from 'next/server'
import { parseLyricPrescriptionInput } from '@/lib/lyric-prescriptions'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

function forbidden(status: number) {
  const error = status === 401 ? '请先登录' : '当前账号没有歌词处方库管理权限'
  return NextResponse.json({ ok: false, data: null, error }, { status })
}

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return forbidden(guard.response.status)

  const searchParams = new URL(request.url).searchParams
  const query = searchParams.get('q')?.trim().slice(0, 80) || ''
  const sort = searchParams.get('sort') === 'displayCount' ? 'displayCount' : 'createdAt'
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'

  try {
    const lyrics = await prisma.lyricPrescription.findMany({
      where: query
        ? {
            OR: [
              { text: { contains: query } },
              { songTitle: { contains: query } },
            ],
          }
        : undefined,
      orderBy: { [sort]: order },
      take: 500,
    })
    return NextResponse.json({ ok: true, data: { lyrics }, error: null })
  } catch (error) {
    console.error('[admin.entertainment.lyrics.list]', error)
    return NextResponse.json({ ok: false, data: null, error: '歌词处方库加载失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) {
    return NextResponse.json({ ok: false, data: null, error: '请求来源校验失败，请刷新页面后重试' }, { status: 403 })
  }
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return forbidden(guard.response.status)
  const parsed = parseLyricPrescriptionInput(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ ok: false, data: null, error: parsed.error }, { status: 400 })

  try {
    const lyric = await prisma.lyricPrescription.create({ data: parsed.data })
    return NextResponse.json({ ok: true, data: { lyric }, error: null }, { status: 201 })
  } catch (error) {
    console.error('[admin.entertainment.lyrics.create]', error)
    return NextResponse.json({ ok: false, data: null, error: '歌词处方创建失败' }, { status: 500 })
  }
}
