import { requireUser } from '@/lib/security'
import { getUndercoverUserStats } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    return undercoverOk({ stats: await getUndercoverUserStats(guard.user.id) })
  } catch (error) {
    return undercoverError(error, '暂时无法加载个人统计。')
  }
}
