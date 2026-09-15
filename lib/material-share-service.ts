import type { Prisma } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { formatDate } from '@/lib/format'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { prisma } from '@/lib/prisma'
import { summarizePlainText } from '@/lib/share-metadata'
import { canonicalShareUrl, SHARE_CARD_CANONICAL_ORIGIN, type ShareCardData } from '@/lib/share-card'
import { isTrustedShareCardImageUrl } from '@/lib/share-card-renderer'
import { getMaterialExchangeState, type MaterialRedemptionStatusValue } from '@/lib/material-redemption-domain'
import { getMaterialExchangeStateLabel, materialScheduleFromRow } from '@/lib/material-redemptions'
import {
  MATERIAL_SHARE_MESSAGE_TYPE,
  MATERIAL_SHARE_TARGET_TYPE,
  MATERIAL_SHARE_UNAVAILABLE_TITLE,
  materialSharePreview,
  materialShareUrl,
  parseMaterialShareSnapshot,
  type MaterialShareMessageView,
  type MaterialShareSnapshot,
} from '@/lib/material-share-types'
import { firstShareCardImageCandidate, shareCardImageCandidates } from '@/lib/share-metadata'

const publicMaterialStatuses: Array<'PUBLISHED' | 'PAUSED' | 'ENDED'> = ['PUBLISHED', 'PAUSED', 'ENDED']

export const materialShareSelect = {
  id: true,
  title: true,
  description: true,
  coverImageUrl: true,
  cost: true,
  stockRemaining: true,
  exchangeStartAt: true,
  exchangeEndAt: true,
  redeemEndAt: true,
  redemptionRule: true,
  linkedActivityId: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  linkedActivity: { select: { startsAt: true, endsAt: true } },
  createdByAdmin: {
    select: {
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      status: true,
      isDeleted: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
} satisfies Prisma.MaterialRedemptionSelect

type ShareableMaterial = Prisma.MaterialRedemptionGetPayload<{ select: typeof materialShareSelect }>

function safeAuthorAvatar(value: string | null | undefined) {
  const candidate = publicImageVariantUrl(profileImageUrl(value), 'avatar-md')
  if (!candidate || !isTrustedShareCardImageUrl(candidate)) return null
  try {
    const parsed = new URL(candidate, SHARE_CARD_CANONICAL_ORIGIN)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function materialStatusLabel(material: ShareableMaterial, now = new Date()) {
  const schedule = materialScheduleFromRow(material)
  const state = getMaterialExchangeState(material.status as MaterialRedemptionStatusValue, schedule, now)
  return { schedule, state, stateLabel: getMaterialExchangeStateLabel(state) }
}

function materialSummary(material: Pick<ShareableMaterial, 'description'>) {
  return summarizePlainText(material.description, 180) || '来自私家E院的物料。'
}

function materialAuthor(material: ShareableMaterial) {
  const creator = material.createdByAdmin
  if (creator.status !== 'ACTIVE' || creator.isDeleted) return { name: '私家E院', avatar: null }
  return {
    name: getPublicUserDisplayName(creator),
    avatar: safeAuthorAvatar(creator.Profile?.avatarUrl || creator.avatarUrl),
  }
}

export async function findShareableMaterial(materialId: string) {
  return prisma.materialRedemption.findFirst({
    where: { id: materialId, status: { in: publicMaterialStatuses } },
    select: materialShareSelect,
  })
}

export function toMaterialShareSnapshot(material: ShareableMaterial, now = new Date()): MaterialShareSnapshot {
  const { state, stateLabel } = materialStatusLabel(material, now)
  const author = materialAuthor(material)
  const description = materialSummary(material)
  const image = firstShareCardImageCandidate([{ url: material.coverImageUrl }])
  return {
    targetType: MATERIAL_SHARE_TARGET_TYPE,
    materialId: material.id,
    title: material.title.trim().slice(0, 120) || '物料兑换',
    description,
    summary: description,
    authorName: author.name,
    imageUrl: image?.url || null,
    status: state,
    statusLabel: stateLabel,
  }
}

export function toMaterialShareMessageView(snapshot: MaterialShareSnapshot, available = true): MaterialShareMessageView {
  return {
    ...snapshot,
    url: canonicalShareUrl(materialShareUrl(snapshot.materialId)),
    available,
  }
}

export function unavailableMaterialShareView(materialId: string): MaterialShareMessageView {
  return {
    targetType: MATERIAL_SHARE_TARGET_TYPE,
    materialId,
    title: MATERIAL_SHARE_UNAVAILABLE_TITLE,
    description: '',
    summary: '',
    authorName: '',
    imageUrl: null,
    status: 'UNAVAILABLE',
    statusLabel: '',
    url: canonicalShareUrl(materialShareUrl(materialId)),
    available: false,
  }
}

export async function resolveMaterialShareViews(
  messages: ReadonlyArray<{ type?: string | null; metadata?: unknown }>,
  _viewerId: string,
) {
  // Material visibility is currently the same public status gate used by the
  // detail API; keep the viewer in the resolver contract for future
  // per-user visibility rules without widening the current public surface.
  void _viewerId
  const snapshots = messages
    .filter((message) => message.type === MATERIAL_SHARE_MESSAGE_TYPE)
    .map((message) => parseMaterialShareSnapshot(message.metadata))
    .filter((snapshot): snapshot is MaterialShareSnapshot => Boolean(snapshot))
  const uniqueIds = [...new Set(snapshots.map((snapshot) => snapshot.materialId))]
  if (!uniqueIds.length) return new Map<string, MaterialShareMessageView>()

  const materials = await prisma.materialRedemption.findMany({
    where: { id: { in: uniqueIds }, status: { in: publicMaterialStatuses } },
    select: materialShareSelect,
  })
  const materialMap = new Map(materials.map((material) => [material.id, material]))
  return new Map(snapshots.map((snapshot) => [
    snapshot.materialId,
    materialMap.has(snapshot.materialId)
      ? toMaterialShareMessageView(toMaterialShareSnapshot(materialMap.get(snapshot.materialId)!), true)
      : unavailableMaterialShareView(snapshot.materialId),
  ]))
}

export async function loadMaterialShareCardData(materialId: string, now = new Date()): Promise<ShareCardData | null> {
  const material = await findShareableMaterial(materialId)
  if (!material) return null
  const { schedule, stateLabel } = materialStatusLabel(material, now)
  const image = firstShareCardImageCandidate([{ url: material.coverImageUrl }])
  const imageCandidates = shareCardImageCandidates([{ url: material.coverImageUrl }])
  const author = materialAuthor(material)
  const summary = materialSummary(material)
  return {
    type: 'material',
    contentId: material.id,
    title: material.title.trim() || '物料兑换',
    description: summary,
    image: image?.url || null,
    imageWidth: image?.width,
    imageHeight: image?.height,
    imageCandidates,
    url: canonicalShareUrl(materialShareUrl(material.id)),
    author: author.name,
    authorAvatar: author.avatar,
    date: formatDate(material.publishedAt || material.createdAt),
    meta: [
      { label: '状态', value: stateLabel },
      { label: '费用', value: material.cost === 0 ? '免费兑换' : `${material.cost} 挂号费` },
      ...(material.stockRemaining < 1 ? [] : [{ label: '库存', value: `剩余 ${material.stockRemaining}` }]),
      ...(schedule.redeemEndAt ? [{ label: '核销截止', value: formatDate(schedule.redeemEndAt) }] : []),
    ],
  }
}

export function materialShareMessageContent(snapshot: Pick<MaterialShareSnapshot, 'title'>) {
  return materialSharePreview(snapshot)
}
