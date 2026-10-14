import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const courses = await prisma.cantoneseCourseDefinition.findMany({
    orderBy: [{ sortOrder: 'asc' }, { lessonNumber: 'asc' }],
    select: {
      lessonId: true, lessonNumber: true, title: true, subtitle: true, description: true,
      sortOrder: true, prerequisiteLessonId: true, status: true, reviewedAt: true, reviewNote: true,
    },
  })
  return NextResponse.json({ courses }, { headers: NO_STORE })
}
