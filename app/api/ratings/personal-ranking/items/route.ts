import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { addPersonalRankingItem, parsePersonalRankingType, PersonalRankingError } from '@/lib/personal-ranking'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'

function errorResponse(error: unknown) {
  if (error instanceof PersonalRankingError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ code: 'DUPLICATE', message: '该作品已经加入榜单' }, { status: 409 })
  console.error('[personal-ranking.item.create]', error)
  return NextResponse.json({ message: '添加榜单作品失败，请稍后重试' }, { status: 503 })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const type = parsePersonalRankingType(body?.type)
  const targetId = sanitizeText(body?.targetId, 100)
  if (!targetId) return NextResponse.json({ code: 'INVALID_TARGET', message: '请选择要加入的作品' }, { status: 400 })
  try {
    return NextResponse.json(await addPersonalRankingItem(guard.user.id, type, targetId), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
