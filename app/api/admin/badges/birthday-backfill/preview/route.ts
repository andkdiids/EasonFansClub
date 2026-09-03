import { NextResponse } from 'next/server'
import { previewBirthdayHistoryBackfill, parseBirthdayHistoryBackfillInput } from '@/lib/birthday-history-backfill'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const parsed = parseBirthdayHistoryBackfillInput(body)
  if ('error' in parsed) return NextResponse.json({ message: parsed.error }, { status: 400 })

  try {
    const summary = await previewBirthdayHistoryBackfill(parsed.input)
    return NextResponse.json({ summary, previewOnly: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.badges.birthday-backfill.preview]', error)
    return NextResponse.json({ message: error instanceof Error ? error.message : '历史补发预览失败' }, { status: 400 })
  }
}
