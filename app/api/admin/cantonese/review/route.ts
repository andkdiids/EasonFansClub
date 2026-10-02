import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseCantoneseReviewEntityType, parseCantoneseReviewStatus, safeReviewIdentifier } from '@/lib/cantonese-review'
import { requireRequestAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function pageNumber(value: string | null) {
  const parsed = Number(value || '1')
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10000) : 1
}

function publicAudioAsset<T extends { cosKey: string | null; audioKey?: string | null; assetStatus: string }>(asset: T) {
  const { cosKey, ...safeAsset } = asset
  const publicAsset = { ...safeAsset }
  delete (publicAsset as { audioKey?: string | null }).audioKey
  return { ...publicAsset, serverSupported: Boolean(cosKey && asset.assetStatus === 'READY') }
}

export async function GET(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })

  const params = new URL(request.url).searchParams
  const type = parseCantoneseReviewEntityType(params.get('type'))
  if (!type) return NextResponse.json({ ok: false, code: 'INVALID_TYPE' }, { status: 400, headers: NO_STORE })

  const rawStatus = params.get('status')
  const status = parseCantoneseReviewStatus(rawStatus)
  if (rawStatus && rawStatus !== 'ALL' && rawStatus !== status) return NextResponse.json({ ok: false, code: 'INVALID_STATUS' }, { status: 400, headers: NO_STORE })
  const rawLessonId = params.get('lessonId')
  const lessonId = safeReviewIdentifier(rawLessonId)
  if (rawLessonId && !lessonId) return NextResponse.json({ ok: false, code: 'INVALID_LESSON_ID' }, { status: 400, headers: NO_STORE })
  const rawKeyword = params.get('q')
  const keyword = safeReviewIdentifier(rawKeyword) || ''
  if (rawKeyword && !keyword) return NextResponse.json({ ok: false, code: 'INVALID_QUERY' }, { status: 400, headers: NO_STORE })
  const page = pageNumber(params.get('page'))
  const skip = (page - 1) * PAGE_SIZE
  const statusFilter = status === 'ALL' ? {} : { status }
  const lessonFilter = lessonId ? { lessonId } : {}

  if (type === 'teaching') {
    const where: Prisma.CantoneseLessonContentWhereInput = {
      ...statusFilter,
      ...lessonFilter,
      ...(keyword ? { OR: [
        { externalId: { contains: keyword } },
        { title: { contains: keyword } },
        { body: { contains: keyword } },
        { displayText: { contains: keyword } },
        { jyutping: { contains: keyword } },
      ] } : {}),
    }
    const [total, items] = await Promise.all([
      prisma.cantoneseLessonContent.count({ where }),
      prisma.cantoneseLessonContent.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { externalId: 'asc' }], skip, take: PAGE_SIZE }),
    ])
    return NextResponse.json({ type, status, lessonId, keyword, page, pageSize: PAGE_SIZE, total, hasMore: skip + items.length < total, items }, { headers: NO_STORE })
  }

  if (type === 'question') {
    const where: Prisma.CantoneseQuestionWhereInput = {
      ...statusFilter,
      ...lessonFilter,
      ...(keyword ? { OR: [
        { externalId: { contains: keyword } },
        { prompt: { contains: keyword } },
        { explanation: { contains: keyword } },
        { audioId: { contains: keyword } },
      ] } : {}),
    }
    const [total, items] = await Promise.all([
      prisma.cantoneseQuestion.count({ where }),
      prisma.cantoneseQuestion.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { externalId: 'asc' }], skip, take: PAGE_SIZE }),
    ])
    return NextResponse.json({ type, status, lessonId, keyword, page, pageSize: PAGE_SIZE, total, hasMore: skip + items.length < total, items }, { headers: NO_STORE })
  }

  const where: Prisma.CantoneseAudioAssetWhereInput = {
    ...statusFilter,
    ...lessonFilter,
    ...(keyword ? { OR: [
      { externalId: { contains: keyword } },
      { text: { contains: keyword } },
      { jyutping: { contains: keyword } },
      { contentId: { contains: keyword } },
    ] } : {}),
  }
  const [total, assets] = await Promise.all([
    prisma.cantoneseAudioAsset.count({ where }),
    prisma.cantoneseAudioAsset.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { externalId: 'asc' }], skip, take: PAGE_SIZE }),
  ])
  const items = assets.map(publicAudioAsset)
  return NextResponse.json({ type, status, lessonId, keyword, page, pageSize: PAGE_SIZE, total, hasMore: skip + items.length < total, items }, { headers: NO_STORE })
}
