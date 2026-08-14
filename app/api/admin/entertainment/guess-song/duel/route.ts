import { duelOk, duelError } from '@/lib/guess-song-duel-api'
import { getDuelAdminMatches } from '@/lib/guess-song-duel-service'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guard.response
  const limit = Number(new URL(request.url).searchParams.get('limit') || 100)
  try {
    return duelOk({ matches: await getDuelAdminMatches(limit) })
  } catch (error) {
    return duelError(error, 'Unable to load duel administration data')
  }
}
