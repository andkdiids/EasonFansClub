import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseTeachingCreate, objectBody } from '@/lib/cantonese-content-admin'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  const body = objectBody(await request.json().catch(() => null))
  const parsed = parseTeachingCreate(body)
  if (!parsed) return error('INVALID_CONTENT', '教学内容参数无效', 400)

  try {
    const result = await prisma.$transaction(async (tx) => {
      let audioId = parsed.audioId
      let audioDraft = null
      if (parsed.requiresAudio && !audioId) audioId = `${parsed.externalId}.audio`
      if (parsed.requiresAudio && audioId) {
        const existingAudio = await tx.cantoneseAudioAsset.findUnique({ where: { externalId: audioId } })
        if (existingAudio && existingAudio.contentId !== parsed.externalId) throw new Error('AUDIO_ID_CONFLICT')
        if (!existingAudio) {
          audioDraft = await tx.cantoneseAudioAsset.create({
            data: {
              externalId: audioId,
              text: parsed.displayText || parsed.body,
              jyutping: parsed.jyutping,
              lessonId: parsed.lessonId,
              contentId: parsed.externalId,
              audioVersion: 'v1',
              voiceProfile: '101019',
              sampleRate: 16000,
              codec: 'mp3',
              assetStatus: 'NOT_GENERATED',
              status: 'CONTENT_REVIEW_REQUIRED',
            },
          })
        }
      }
      const content = await tx.cantoneseLessonContent.create({
        data: {
          ...parsed,
          audioId,
          status: 'CONTENT_REVIEW_REQUIRED',
        },
      })
      return { content, audioDraft }
    })
    return NextResponse.json({ item: result.content, audioDraft: result.audioDraft }, { status: 201, headers: NO_STORE })
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'AUDIO_ID_CONFLICT') return error('AUDIO_ID_CONFLICT', '音频 ID 已关联其他教学内容', 409)
    if ((cause as { code?: string })?.code === 'P2002') return error('DUPLICATE_CONTENT_ID', '教学内容 ID 已存在', 409)
    return error('CONTENT_CREATE_FAILED', '创建教学内容失败，请稍后重试', 500)
  }
}
