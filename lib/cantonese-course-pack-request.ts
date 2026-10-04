import { NextResponse } from 'next/server'
import { buildV6CoursePackSeedPayload, findV6CoursePack } from '@/lib/cantonese-course-packs'
import { parseCandidateImport } from '@/lib/cantonese-candidate-import'

/** Accept existing explicit payloads and a server-resolved pack reference. */
export function parseCantoneseSeedRequest(rawBody: string) {
  let body: unknown
  try { body = JSON.parse(rawBody) as unknown } catch { return parseCandidateImport(rawBody) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return parseCandidateImport(rawBody)
  const request = body as Record<string, unknown>
  if (typeof request.packId !== 'string') return parseCandidateImport(rawBody)

  const pack = findV6CoursePack(request.packId)
  if (!pack) return NextResponse.json({ ok: false, code: 'UNKNOWN_COURSE_PACK' }, { status: 404 })
  const selectedLessonId = typeof request.selectedLessonId === 'string' ? request.selectedLessonId : request.packId
  if (selectedLessonId !== request.packId) return NextResponse.json({ ok: false, code: 'PACK_LESSON_MISMATCH' }, { status: 400 })
  const payload = buildV6CoursePackSeedPayload(request.packId)
  return parseCandidateImport(JSON.stringify({
    ...payload,
    selectedLessonId,
    updateExistingCandidates: request.updateExistingCandidates === true,
  }))
}
