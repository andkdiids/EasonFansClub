import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseCantoneseReviewEntityType, parseCantoneseReviewStatus, safeReviewIdentifier } from '@/lib/cantonese-review'
import { requireRequestAdmin } from '@/lib/security'
import { cantoneseJyutpingReviewDigest, cantoneseJyutpingReviewStatus, CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION, isLatestJyutpingVerification } from '@/lib/cantonese-jyutping-review'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const V6_PREFIX = 'cantonese.v6.'

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

async function includeJyutpingReviewStatus<T extends { externalId: string }>(
  items: T[], targetType: 'TEACHING' | 'AUDIO', needsReview: (item: T) => boolean,
  getText: (item: T) => string | null, getJyutping: (item: T) => string | null,
) {
  const digests = items.map((item) => ({ item, digest: cantoneseJyutpingReviewDigest(getText(item), getJyutping(item)) }))
    .filter((row): row is { item: T; digest: string } => Boolean(row.digest && needsReview(row.item)))
  const logs = digests.length ? await prisma.cantoneseReviewLog.findMany({
    where: { targetType, action: { in: [CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION] }, targetId: { in: digests.map((row) => row.item.externalId) }, reason: { in: digests.map((row) => row.digest) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { targetId: true, reason: true, action: true, createdAt: true },
  }) : []
  const byTarget = new Map<string, typeof logs>()
  for (const log of logs) byTarget.set(log.targetId, [...(byTarget.get(log.targetId) || []), log])
  return items.map((item) => {
    const digest = cantoneseJyutpingReviewDigest(getText(item), getJyutping(item))
    const status = cantoneseJyutpingReviewStatus({ text: getText(item), jyutping: getJyutping(item), needsJyutping: needsReview(item), verificationReason: digest && isLatestJyutpingVerification(byTarget.get(item.externalId) || [], digest) ? digest : null })
    return { ...item, jyutpingReviewStatus: status }
  })
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
  const source = params.get('source') || 'ALL'
  if (source !== 'ALL' && source !== 'LEGACY' && source !== 'COURSE_PACK_V6') return NextResponse.json({ ok: false, code: 'INVALID_SOURCE' }, { status: 400, headers: NO_STORE })
  const sourceFilter = source === 'COURSE_PACK_V6' ? { externalId: { startsWith: V6_PREFIX } }
    : source === 'LEGACY' ? { NOT: { externalId: { startsWith: V6_PREFIX } } } : {}

  if (type === 'teaching') {
    const where: Prisma.CantoneseLessonContentWhereInput = {
      ...statusFilter,
      ...lessonFilter,
      ...sourceFilter,
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
    const decorated = await includeJyutpingReviewStatus(items, 'TEACHING', (item) => item.requiresAudio || item.requiresSpeaking, (item) => item.displayText, (item) => item.jyutping)
    const audioIds = [...new Set(decorated.filter((item) => item.requiresAudio && item.audioId).map((item) => item.audioId!))]
    const assets = audioIds.length ? await prisma.cantoneseAudioAsset.findMany({ where: { externalId: { in: audioIds } }, select: { externalId: true, status: true, assetStatus: true, cosKey: true, checksum: true, fileSize: true } }) : []
    const audioById = new Map(assets.map((asset) => [asset.externalId, asset]))
    const withAudio = decorated.map((item) => {
      const asset = item.audioId ? audioById.get(item.audioId) : null
      return { ...item, audioReviewStatus: asset?.status || null, audioAssetStatus: asset?.assetStatus || null, audioReady: Boolean(asset?.status === 'APPROVED' && asset.assetStatus === 'READY' && asset.cosKey && asset.checksum && asset.fileSize) }
    })
    return NextResponse.json({ type, status, lessonId, source, keyword, page, pageSize: PAGE_SIZE, total, hasMore: skip + items.length < total, items: withAudio }, { headers: NO_STORE })
  }

  if (type === 'question') {
    const where: Prisma.CantoneseQuestionWhereInput = {
      ...statusFilter,
      ...lessonFilter,
      ...sourceFilter,
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
    const audioIds = [...new Set(items.filter((item) => (item.questionType === 'LISTENING' || item.questionType === 'SPEAKING') && item.audioId).map((item) => item.audioId!))]
    const assets = audioIds.length ? await prisma.cantoneseAudioAsset.findMany({ where: { externalId: { in: audioIds } }, select: { externalId: true, status: true, assetStatus: true, cosKey: true, checksum: true, fileSize: true } }) : []
    const audioById = new Map(assets.map((asset) => [asset.externalId, asset]))
    const withAudio = items.map((item) => {
      const asset = item.audioId ? audioById.get(item.audioId) : null
      return { ...item, audioReviewStatus: asset?.status || null, audioAssetStatus: asset?.assetStatus || null, audioReady: Boolean(asset?.status === 'APPROVED' && asset.assetStatus === 'READY' && asset.cosKey && asset.checksum && asset.fileSize) }
    })
    return NextResponse.json({ type, status, lessonId, source, keyword, page, pageSize: PAGE_SIZE, total, hasMore: skip + items.length < total, items: withAudio }, { headers: NO_STORE })
  }

  const where: Prisma.CantoneseAudioAssetWhereInput = {
    ...statusFilter,
    ...lessonFilter,
    ...sourceFilter,
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
  const decorated = await includeJyutpingReviewStatus(items, 'AUDIO', () => true, (item) => item.text, (item) => item.jyutping)
  return NextResponse.json({ type, status, lessonId, source, keyword, page, pageSize: PAGE_SIZE, total, hasMore: skip + items.length < total, items: decorated }, { headers: NO_STORE })
}
