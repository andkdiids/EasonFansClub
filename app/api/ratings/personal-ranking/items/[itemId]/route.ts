import { NextResponse } from 'next/server'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { PersonalRankingError, removePersonalRankingItem, updatePersonalRankingNote } from '@/lib/personal-ranking'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ itemId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof PersonalRankingError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
  console.error('[personal-ranking.item]', error)
  return NextResponse.json({ message: '修改榜单失败，请稍后重试' }, { status: 503 })
}

export async function PATCH(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const note = sanitizeText(body?.note, 1000)
  if (note && (await checkBannedWords(note)).blocked) return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  const { itemId } = await params
  try {
    return NextResponse.json(await updatePersonalRankingNote(guard.user.id, itemId, note || null))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { itemId } = await params
  try {
    return NextResponse.json(await removePersonalRankingItem(guard.user.id, itemId))
  } catch (error) {
    return errorResponse(error)
  }
}
