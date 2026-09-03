import { NextResponse } from 'next/server'
import { birthdayHistoryBackfillAuditDetail, executeBirthdayHistoryBackfill, parseBirthdayHistoryBackfillInput } from '@/lib/birthday-history-backfill'
import { writeBadgeAdminAction } from '@/lib/badge-service'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (body?.confirmed !== true) return NextResponse.json({ message: '请先确认执行历史补发' }, { status: 400 })
  const parsed = parseBirthdayHistoryBackfillInput(body)
  if ('error' in parsed) return NextResponse.json({ message: parsed.error }, { status: 400 })

  try {
    const summary = await executeBirthdayHistoryBackfill(parsed.input)
    await prisma.$transaction(async (tx) => {
      await writeBadgeAdminAction(tx, {
        actorId: guard.user!.id,
        action: 'BADGE_HISTORY_BACKFILL',
        detail: birthdayHistoryBackfillAuditDetail(summary),
      })
    })
    return NextResponse.json({ summary, executed: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.badges.birthday-backfill.execute]', error)
    return NextResponse.json({ message: error instanceof Error ? error.message : '历史补发执行失败' }, { status: 400 })
  }
}
