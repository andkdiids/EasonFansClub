import { createDuelRoom, listDuelRooms, searchDuelRoom } from '@/lib/guess-song-duel-service'
import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const q = new URL(request.url).searchParams.get('q')
  try {
    return duelOk({ rooms: q ? [await searchDuelRoom(q)] : await listDuelRooms() })
  } catch (error) {
    if (q) return duelError(error)
    return duelError(error, 'Unable to load duel rooms')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    return duelOk({ room: await createDuelRoom(guard.user.id, {
      roomCode: body?.roomCode,
      password: body?.password,
      isPublic: body?.isPublic,
      mode: body?.mode,
    }) })
  } catch (error) {
    return duelError(error, 'Unable to create duel room')
  }
}
