import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseAudioCreate, objectBody, publicAudioAsset } from '@/lib/cantonese-content-admin'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function error(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  const parsed = parseAudioCreate(objectBody(await request.json().catch(() => null)))
  if (!parsed) return error('INVALID_AUDIO', '音频参数无效', 400)
  try {
    const item = await prisma.cantoneseAudioAsset.create({
      data: { ...parsed, status: 'CONTENT_REVIEW_REQUIRED', assetStatus: 'NOT_GENERATED' },
    })
    return NextResponse.json({ item: publicAudioAsset(item) }, { status: 201, headers: NO_STORE })
  } catch (cause) {
    if ((cause as { code?: string })?.code === 'P2002') return error('DUPLICATE_AUDIO_ID', '音频 ID 已存在', 409)
    return error('AUDIO_CREATE_FAILED', '创建音频资源失败，请稍后重试', 500)
  }
}
