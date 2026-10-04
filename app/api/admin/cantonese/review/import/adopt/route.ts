import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { parseCantoneseSeedRequest } from '@/lib/cantonese-course-pack-request'
import { planSeedRows } from '@/lib/cantonese-seed-import'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
type TargetType = 'definition' | 'teaching' | 'question' | 'audio'
const targetTypes = new Set<TargetType>(['definition', 'teaching', 'question', 'audio'])

/** Explicitly adopt one changed APPROVED candidate; never approve it in this call. */
export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const raw = await request.text().catch(() => '')
  const body = (() => { try { return JSON.parse(raw) as Record<string, unknown> } catch { return null } })()
  if (!body || body.confirmed !== true || typeof body.targetType !== 'string' || !targetTypes.has(body.targetType as TargetType)
    || typeof body.targetId !== 'string' || typeof body.expectedUpdatedAt !== 'string') {
    return NextResponse.json({ ok: false, code: 'ADOPTION_CONFIRMATION_REQUIRED' }, { status: 400, headers: NO_STORE })
  }
  const type = body.targetType as TargetType
  const targetId = body.targetId
  if (!/^[a-zA-Z0-9._:-]{1,191}$/.test(targetId)) return NextResponse.json({ ok: false, code: 'INVALID_TARGET' }, { status: 400, headers: NO_STORE })
  const expectedUpdatedAt = new Date(body.expectedUpdatedAt)
  if (Number.isNaN(expectedUpdatedAt.getTime())) return NextResponse.json({ ok: false, code: 'INVALID_VERSION' }, { status: 400, headers: NO_STORE })
  const parsed = parseCantoneseSeedRequest(raw)
  if (parsed instanceof NextResponse) return parsed
  const rows = type === 'definition' ? parsed.definitions : type === 'teaching' ? parsed.teaching : type === 'question' ? parsed.questions : parsed.audio
  const key = type === 'definition' ? 'lessonId' : 'externalId'
  const candidate = rows.find((row) => (row as unknown as Record<string, unknown>)[key] === targetId)
  if (!candidate) return NextResponse.json({ ok: false, code: 'CANDIDATE_NOT_FOUND' }, { status: 404, headers: NO_STORE })

  const result = await prisma.$transaction(async (tx) => {
    const current = type === 'definition'
      ? await tx.cantoneseCourseDefinition.findUnique({ where: { lessonId: targetId } })
      : type === 'teaching'
        ? await tx.cantoneseLessonContent.findUnique({ where: { externalId: targetId } })
        : type === 'question'
          ? await tx.cantoneseQuestion.findUnique({ where: { externalId: targetId } })
          : await tx.cantoneseAudioAsset.findUnique({ where: { externalId: targetId } })
    if (!current || current.status !== 'APPROVED') return 'NOT_APPROVED'
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return 'STALE_REVIEW'
    const plan = planSeedRows([candidate], [current], type, key)
    if (plan[0]?.decision !== 'UPDATE_AVAILABLE') return 'NO_UPDATE_AVAILABLE'
    let count = 0
    if (type === 'definition') {
      const { lessonId, status: _status, ...fields } = candidate as typeof parsed.definitions[number]
      void _status
      count = (await tx.cantoneseCourseDefinition.updateMany({ where: { lessonId, status: 'APPROVED', updatedAt: expectedUpdatedAt }, data: {
        ...fields, status: 'CONTENT_REVIEW_REQUIRED', reviewedById: null, reviewedAt: null, reviewNote: null,
      } })).count
    } else if (type === 'teaching') {
      const { externalId, status: _status, ...fields } = candidate as typeof parsed.teaching[number]
      void _status
      count = (await tx.cantoneseLessonContent.updateMany({ where: { externalId, status: 'APPROVED', updatedAt: expectedUpdatedAt }, data: {
        ...fields, status: 'CONTENT_REVIEW_REQUIRED', reviewedById: null, reviewedAt: null, reviewNote: null,
      } })).count
    } else if (type === 'question') {
      const { externalId, status: _status, ...fields } = candidate as typeof parsed.questions[number]
      void _status
      count = (await tx.cantoneseQuestion.updateMany({ where: { externalId, status: 'APPROVED', updatedAt: expectedUpdatedAt }, data: {
        ...fields, status: 'CONTENT_REVIEW_REQUIRED', reviewedById: null, reviewedAt: null, reviewNote: null,
      } })).count
    } else {
      const { externalId, status: _status, assetStatus: _assetStatus, ...fields } = candidate as typeof parsed.audio[number]
      void _status
      void _assetStatus
      count = (await tx.cantoneseAudioAsset.updateMany({ where: { externalId, status: 'APPROVED', updatedAt: expectedUpdatedAt }, data: {
        ...fields, status: 'CONTENT_REVIEW_REQUIRED', assetStatus: 'NEEDS_REGENERATION',
        audioKey: null, cosKey: null, checksum: null, fileSize: null,
        reviewedById: null, reviewedAt: null, reviewNote: null,
      } })).count
    }
    if (count !== 1) return 'STALE_REVIEW'
    await tx.cantoneseReviewLog.create({ data: {
      reviewerId: guard.user!.id, targetType: type.toUpperCase(), targetId,
      action: 'ADOPT_CANDIDATE', oldStatus: 'APPROVED', newStatus: 'CONTENT_REVIEW_REQUIRED',
      reason: '管理员确认采用新版候选；须重新审核',
    } })
    return 'ADOPTED_PENDING'
  })
  if (result !== 'ADOPTED_PENDING') return NextResponse.json({ ok: false, code: result }, { status: 409, headers: NO_STORE })
  return NextResponse.json({ ok: true, code: result, targetType: type, targetId, status: 'CONTENT_REVIEW_REQUIRED' }, { headers: NO_STORE })
}
