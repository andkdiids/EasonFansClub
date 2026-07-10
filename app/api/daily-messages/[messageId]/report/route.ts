import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const body = await request.json().catch(() => null)
  const reason = sanitizeText(body?.reason, 120) || '用户举报'
  const description = sanitizeText(body?.description, 300) || null

  const report = await prisma.report.create({
    data: {
      reporterId: guard.user.id,
      targetType: 'DAILY_MESSAGE',
      dailyMessageId: messageId,
      reason,
      description,
    },
  })

  return NextResponse.json({ report }, { status: 201 })
}
