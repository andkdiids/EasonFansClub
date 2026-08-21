import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]/report',
    ip: { limit: 30, windowSeconds: 60 * 60 },
    user: { limit: 10, windowSeconds: 60 * 60 },
  })
  if (limited) return limited

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
