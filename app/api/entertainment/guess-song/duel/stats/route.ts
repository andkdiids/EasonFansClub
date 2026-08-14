import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { getDuelStats, listDuelHistory } from '@/lib/guess-song-duel-service'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    return duelOk({ stats: await getDuelStats(guard.user.id), history: await listDuelHistory(guard.user.id) })
  } catch (error) {
    return duelError(error, 'Unable to load duel record')
  }
}
