import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reportSticker } from '@/lib/sticker-center'
import type { StickerReportReason } from '@prisma/client'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

const VALID_REASONS: StickerReportReason[] = ['PORN', 'ABUSE', 'VIOLATION', 'OTHER']

/** 举报违规表情包。 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()

  const body = await request.json().catch(() => null)
  const stickerId = String(body?.stickerId || '').trim()
  const reason = String(body?.reason || '') as StickerReportReason
  const detail = body?.detail != null ? String(body.detail) : undefined
  if (!stickerId) return NextResponse.json({ message: '缺少表情标识' }, { status: 400 })
  if (!VALID_REASONS.includes(reason)) return NextResponse.json({ message: '举报原因无效' }, { status: 400 })

  const sticker = await prisma.sticker.findFirst({
    where: { id: stickerId, isHidden: false },
    select: { id: true },
  })
  if (!sticker) return NextResponse.json({ message: '表情不存在' }, { status: 404 })

  try {
    const result = await reportSticker({ userId: user.id, stickerId, reason, detail })
    if (!result.reported) return NextResponse.json({ success: true, reported: false, message: '已收到你的举报' })
    return NextResponse.json({ success: true, reported: true, message: '举报已提交，我们会尽快处理' })
  } catch (error) {
    console.error('[sticker.report]', error)
    return NextResponse.json({ message: '举报失败，请稍后重试' }, { status: 500 })
  }
}
