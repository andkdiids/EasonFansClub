import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseQuestionCreate, objectBody } from '@/lib/cantonese-content-admin'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  const parsed = parseQuestionCreate(objectBody(await request.json().catch(() => null)))
  if (!parsed) return error('INVALID_QUESTION', '题目参数无效', 400)
  try {
    if (parsed.lyricPrescriptionId) {
      const source = await prisma.lyricPrescription.findUnique({ where: { id: parsed.lyricPrescriptionId }, select: { id: true } })
      if (!source) return error('LYRIC_SOURCE_NOT_FOUND', '关联的歌词来源不存在', 400)
    }
    const item = await prisma.cantoneseQuestion.create({
      data: { ...parsed, status: 'CONTENT_REVIEW_REQUIRED' },
    })
    return NextResponse.json({ item }, { status: 201, headers: NO_STORE })
  } catch (cause) {
    if ((cause as { code?: string })?.code === 'P2002') return error('DUPLICATE_QUESTION_ID', '题目 ID 已存在', 409)
    return error('QUESTION_CREATE_FAILED', '创建题目失败，请稍后重试', 500)
  }
}
