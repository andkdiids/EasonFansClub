import { NextResponse } from 'next/server'
import { requireUser, enforceApiRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { writeEasMusicAlbumLike } from '@/lib/easmusic-likes'

type Context = { params: Promise<{ albumId: string }> }

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: noStoreHeaders })
}

async function handle(request: Request, context: Context, liked: boolean) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/music/albums/like',
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited

  const { albumId: rawAlbumId } = await context.params
  const albumId = rawAlbumId?.trim()
  if (!albumId) return json({ code: 'INVALID_TARGET', message: '专辑 ID 无效' }, 400)

  try {
    const result = await writeEasMusicAlbumLike({ albumId, userId: guard.user.id, liked })
    if (!result) return json({ code: 'ALBUM_NOT_FOUND', message: '专辑不存在或未发布' }, 404)
    return json(result)
  } catch (error) {
    console.error('[easmusic.album.like]', { albumId, userId: guard.user.id, liked, error })
    return json({ code: 'EASMUSIC_LIKE_FAILED', message: '专辑点赞操作失败，请稍后重试' }, 503)
  }
}

export async function POST(request: Request, context: Context) {
  return handle(request, context, true)
}

export async function DELETE(request: Request, context: Context) {
  return handle(request, context, false)
}
