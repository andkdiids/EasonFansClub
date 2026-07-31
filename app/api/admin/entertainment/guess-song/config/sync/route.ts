import { syncAutoGuessQuestions } from '@/lib/guess-song-auto'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  try {
    const result = await syncAutoGuessQuestions(10)
    return guessSongOk({ sync: result })
  } catch (error) {
    return handleGuessSongError(error, 'admin.quizConfig.sync')
  }
}
