import { Prisma, type WantListenFakeTitleDifficulty } from '@prisma/client'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { normalizeWantListenTitle } from '@/lib/want-listen-title'
import { wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const runtime = 'nodejs'

function validDifficulty(value: unknown): value is WantListenFakeTitleDifficulty {
  return value === 'EASY' || value === 'NORMAL' || value === 'HARD'
}

async function hasRealConflict(title: string) {
  const songs = await prisma.musicSong.findMany({ where: { title: { not: '' }, MusicAlbum: { status: 'PUBLISHED' } }, select: { title: true } })
  const key = normalizeWantListenTitle(title)
  return songs.some((song) => normalizeWantListenTitle(song.title) === key)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前账号没有想听管理权限', guard.response.status)
  const { id } = await params
  const body = await request.json().catch(() => null) as { title?: unknown; difficulty?: unknown; enabled?: unknown } | null
  const current = await prisma.wantListenFakeTitle.findUnique({ where: { id } })
  if (!current) return wantListenError('假歌名不存在。', 404, 'FAKE_TITLE_NOT_FOUND')
  const title = body?.title === undefined ? current.title : sanitizeText(body.title, 100)
  const difficulty = body?.difficulty === undefined ? current.difficulty : body.difficulty
  if (!title || !normalizeWantListenTitle(title)) return wantListenError('请输入有效的假歌名。', 400, 'FAKE_TITLE_INVALID')
  if (!validDifficulty(difficulty)) return wantListenError('假歌名难度无效。', 400, 'FAKE_TITLE_DIFFICULTY_INVALID')
  if (await hasRealConflict(title)) return wantListenError('该歌名已存在于真实曲库，不能作为假歌名。', 409, 'FAKE_TITLE_REAL_CONFLICT')
  try {
    const row = await prisma.wantListenFakeTitle.update({ where: { id }, data: { title, normalizedTitle: normalizeWantListenTitle(title), difficulty, ...(typeof body?.enabled === 'boolean' ? { enabled: body.enabled } : {}) } })
    return wantListenOk({ row })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return wantListenError('该假歌名已经存在。', 409, 'FAKE_TITLE_DUPLICATE')
    console.error('[want-listen.admin.fake-title.update]', error)
    return wantListenError('假歌名保存失败，请稍后再试。', 500, 'SERVICE_UNAVAILABLE')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前账号没有想听管理权限', guard.response.status)
  const { id } = await params
  try {
    await prisma.wantListenFakeTitle.delete({ where: { id } })
    return wantListenOk({ deleted: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return wantListenError('假歌名不存在。', 404, 'FAKE_TITLE_NOT_FOUND')
    console.error('[want-listen.admin.fake-title.delete]', error)
    return wantListenError('假歌名删除失败，请稍后再试。', 500, 'SERVICE_UNAVAILABLE')
  }
}
