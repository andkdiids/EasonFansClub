import { Prisma } from '@prisma/client'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

type Context = { params: Promise<{ songId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)

  const body = await request.json().catch(() => null) as { expertEnabled?: unknown } | null
  if (typeof body?.expertEnabled !== 'boolean') return guessSongError('专家模式开关参数无效', 400)

  const { songId } = await params
  try {
    const song = await prisma.musicSong.update({
      where: { id: songId },
      data: { expertEnabled: body.expertEnabled },
      select: { id: true, expertEnabled: true },
    })
    const response = guessSongOk({ song })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return guessSongError('歌曲不存在', 404)
    }
    return handleGuessSongError(error, 'admin.music-song.expert-enabled')
  }
}
