import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isBatchApprovalAllowed, parseCantoneseReviewEntityType, safeReviewIdentifier, safeReviewReason } from '@/lib/cantonese-review'
import { teachingAudioReady } from '@/lib/cantonese-content-admin'
import { cantoneseJyutpingReviewDigest, CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION, isLatestJyutpingVerification } from '@/lib/cantonese-jyutping-review'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const type = parseCantoneseReviewEntityType(typeof body?.type === 'string' ? body.type : null)
  const action = body?.action
  const rawIds = body?.ids
  if (!body || !type || (action !== 'approve' && action !== 'reject') || !Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 50) {
    return NextResponse.json({ ok: false, code: 'INVALID_BATCH' }, { status: 400, headers: NO_STORE })
  }
  const ids = [...new Set(rawIds.map(safeReviewIdentifier).filter((id): id is string => Boolean(id)))]
  if (ids.length !== rawIds.length) return NextResponse.json({ ok: false, code: 'INVALID_BATCH_IDS' }, { status: 400, headers: NO_STORE })
  const reason = body.reason === undefined ? null : safeReviewReason(body.reason)
  if (action === 'reject' && !reason) return NextResponse.json({ ok: false, code: 'REJECTION_REASON_REQUIRED' }, { status: 400, headers: NO_STORE })
  if (body.reason !== undefined && !reason) return NextResponse.json({ ok: false, code: 'INVALID_REASON' }, { status: 400, headers: NO_STORE })
  // The workbench must present the exact selected IDs and ask for confirmation.
  if (type === 'teaching' && action === 'approve' && body.confirmed !== true) {
    return NextResponse.json({ ok: false, code: 'CONFIRMATION_REQUIRED' }, { status: 400, headers: NO_STORE })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const applied: string[] = []
      const blocked: string[] = []
      const missing: string[] = []
      const skipped: string[] = []
      const nextStatus = action === 'approve' ? 'APPROVED' as const : 'REJECTED' as const

      for (const id of ids) {
        if (type === 'teaching') {
          const current = await tx.cantoneseLessonContent.findUnique({ where: { externalId: id } })
          if (!current) { missing.push(id); continue }
          if (action === 'approve') {
            const digest = cantoneseJyutpingReviewDigest(current.displayText, current.jyutping)
            const verificationLogs = digest && (current.requiresAudio || current.requiresSpeaking)
              ? await tx.cantoneseReviewLog.findMany({ where: { targetType: 'TEACHING', targetId: id, action: { in: [CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION] }, reason: digest }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true, reason: true, createdAt: true } })
              : []
            if ((current.requiresAudio || current.requiresSpeaking) && !isLatestJyutpingVerification(verificationLogs, digest)) { blocked.push(id); continue }
            const audio = current.audioId && current.requiresAudio
              ? await tx.cantoneseAudioAsset.findUnique({ where: { externalId: current.audioId } })
              : null
            if (!teachingAudioReady(current, audio)) { blocked.push(id); continue }
            if (audio && (audio.text !== current.displayText || audio.jyutping !== current.jyutping)) { blocked.push(id); continue }
          }
          if (current.status === nextStatus) { skipped.push(id); continue }
          const updated = await tx.cantoneseLessonContent.update({ where: { externalId: id }, data: { status: nextStatus, reviewer: { connect: { id: guard.user!.id } }, reviewedAt: new Date(), reviewNote: reason } })
          await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user!.id } }, targetType: 'TEACHING', targetId: id, action: action.toUpperCase(), oldStatus: current.status, newStatus: updated.status, reason } })
          applied.push(id)
          continue
        }
        if (type === 'question') {
          const current = await tx.cantoneseQuestion.findUnique({ where: { externalId: id } })
          if (!current) { missing.push(id); continue }
          if (action === 'approve' && !isBatchApprovalAllowed({ type, questionType: current.questionType, audioId: current.audioId, lyricPrescriptionId: current.lyricPrescriptionId, prompt: current.prompt, explanation: current.explanation })) { blocked.push(id); continue }
          if (current.status === nextStatus) { skipped.push(id); continue }
          const updated = await tx.cantoneseQuestion.update({ where: { externalId: id }, data: { status: nextStatus, reviewer: { connect: { id: guard.user!.id } }, reviewedAt: new Date(), reviewNote: reason } })
          await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user!.id } }, targetType: 'QUESTION', targetId: id, action: action.toUpperCase(), oldStatus: current.status, newStatus: updated.status, reason } })
          applied.push(id)
          continue
        }
        const current = await tx.cantoneseAudioAsset.findUnique({ where: { externalId: id } })
        if (!current) { missing.push(id); continue }
        if (action === 'approve') { blocked.push(id); continue }
        if (current.status === nextStatus) { skipped.push(id); continue }
        const updated = await tx.cantoneseAudioAsset.update({ where: { externalId: id }, data: { status: nextStatus, reviewer: { connect: { id: guard.user!.id } }, reviewedAt: new Date(), reviewNote: reason } })
        await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user!.id } }, targetType: 'AUDIO', targetId: id, action: action.toUpperCase(), oldStatus: current.status, newStatus: updated.status, reason } })
        applied.push(id)
      }
      return { applied, blocked, missing, skipped }
    })
    return NextResponse.json(result, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'BATCH_REVIEW_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
