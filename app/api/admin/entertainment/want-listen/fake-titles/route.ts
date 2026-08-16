import { Prisma, type WantListenFakeTitleDifficulty } from '@prisma/client'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { normalizeWantListenTitle } from '@/lib/want-listen-title'
import { wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function validDifficulty(value: unknown): value is WantListenFakeTitleDifficulty {
  return value === 'EASY' || value === 'NORMAL' || value === 'HARD'
}

async function realTitleKeys() {
  const songs = await prisma.musicSong.findMany({ where: { title: { not: '' }, MusicAlbum: { status: 'PUBLISHED' } }, select: { title: true } })
  return new Set(songs.map((song) => normalizeWantListenTitle(song.title)).filter(Boolean))
}

async function ensureNotRealTitle(title: string) {
  const keys = await realTitleKeys()
  if (keys.has(normalizeWantListenTitle(title))) return wantListenError('该歌名已存在于真实曲库，不能作为假歌名。', 409, 'FAKE_TITLE_REAL_CONFLICT')
  return null
}

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前账号没有想听管理权限', guard.response.status)
  const params = new URL(request.url).searchParams
  const page = Math.max(1, Number(params.get('page') || 1) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(params.get('pageSize') || 20) || 20))
  const search = sanitizeText(params.get('q'), 100)
  const difficulty = validDifficulty(params.get('difficulty')) ? params.get('difficulty') as WantListenFakeTitleDifficulty : undefined
  const where = { ...(search ? { title: { contains: search } } : {}), ...(difficulty ? { difficulty } : {}) }
  const [rows, total, keys] = await Promise.all([
    prisma.wantListenFakeTitle.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.wantListenFakeTitle.count({ where }),
    realTitleKeys(),
  ])
  return wantListenOk({ rows: rows.map((row) => ({ ...row, conflict: keys.has(normalizeWantListenTitle(row.title)) })), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前账号没有想听管理权限', guard.response.status)
  const body = await request.json().catch(() => null) as { title?: unknown; difficulty?: unknown; enabled?: unknown } | null
  const title = sanitizeText(body?.title, 100)
  const normalizedTitle = normalizeWantListenTitle(title)
  if (!title || !normalizedTitle) return wantListenError('请输入有效的假歌名。', 400, 'FAKE_TITLE_INVALID')
  if (!validDifficulty(body?.difficulty)) return wantListenError('假歌名难度无效。', 400, 'FAKE_TITLE_DIFFICULTY_INVALID')
  const conflict = await ensureNotRealTitle(title)
  if (conflict) return conflict
  try {
    const row = await prisma.wantListenFakeTitle.create({ data: { title, normalizedTitle, difficulty: body.difficulty, enabled: body?.enabled !== false } })
    return wantListenOk({ row }, 201)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return wantListenError('该假歌名已经存在。', 409, 'FAKE_TITLE_DUPLICATE')
    console.error('[want-listen.admin.fake-title.create]', error)
    return wantListenError('假歌名保存失败，请稍后再试。', 500, 'SERVICE_UNAVAILABLE')
  }
}
