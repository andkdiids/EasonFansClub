import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { parseLyricPrescriptionInput } from '@/lib/lyric-prescriptions'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

type Context = { params: Promise<{ lyricId: string }> }

function forbidden(status: number) {
  const error = status === 401 ? '请先登录' : '当前账号没有歌词处方库管理权限'
  return NextResponse.json({ ok: false, data: null, error }, { status })
}

export async function PATCH(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) {
    return NextResponse.json({ ok: false, data: null, error: '请求来源校验失败，请刷新页面后重试' }, { status: 403 })
  }
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return forbidden(guard.response.status)
  const { lyricId } = await params
  const parsed = parseLyricPrescriptionInput(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ ok: false, data: null, error: parsed.error }, { status: 400 })

  try {
    const lyric = await prisma.lyricPrescription.update({
      where: { id: lyricId },
      data: parsed.data,
    })
    return NextResponse.json({ ok: true, data: { lyric }, error: null })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ ok: false, data: null, error: '歌词处方不存在' }, { status: 404 })
    }
    console.error('[admin.entertainment.lyrics.update]', error)
    return NextResponse.json({ ok: false, data: null, error: '歌词处方保存失败' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) {
    return NextResponse.json({ ok: false, data: null, error: '请求来源校验失败，请刷新页面后重试' }, { status: 403 })
  }
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return forbidden(guard.response.status)
  const { lyricId } = await params

  try {
    const historyCount = await prisma.entertainmentDailyDraw.count({
      where: { lyricPrescriptionId: lyricId },
    })
    if (historyCount > 0) {
      return NextResponse.json(
        { ok: false, data: null, error: '该歌词已有历史记录，请停用而不是删除' },
        { status: 409 },
      )
    }
    await prisma.lyricPrescription.delete({ where: { id: lyricId } })
    return NextResponse.json({ ok: true, data: { id: lyricId }, error: null })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ ok: false, data: null, error: '歌词处方不存在' }, { status: 404 })
    }
    console.error('[admin.entertainment.lyrics.delete]', error)
    return NextResponse.json({ ok: false, data: null, error: '歌词处方删除失败' }, { status: 500 })
  }
}
