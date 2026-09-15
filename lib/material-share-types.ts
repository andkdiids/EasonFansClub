import { canonicalShareUrl, type ShareCardData } from '@/lib/share-card'

export const MATERIAL_SHARE_MESSAGE_TYPE = 'MATERIAL_SHARE' as const
export const MATERIAL_SHARE_TARGET_TYPE = 'MATERIAL' as const
export const MATERIAL_SHARE_UNAVAILABLE_TITLE = '该物料已不存在或暂不可查看'

export type MaterialShareSnapshot = Readonly<{
  targetType: typeof MATERIAL_SHARE_TARGET_TYPE
  materialId: string
  title: string
  description: string
  summary: string
  authorName: string
  imageUrl: string | null
  status: string
  statusLabel: string
}>

export type MaterialShareMessageView = MaterialShareSnapshot & Readonly<{
  url: string
  available: boolean
}>

export type MaterialShareCardInput = Readonly<{
  id: string
  title: string
  description: string | null | undefined
  coverImageUrl: string | null | undefined
  stateLabel: string
  cost?: number
  publishedAt?: string | null
}>

function optionalString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function parseMaterialShareSnapshot(value: unknown): MaterialShareSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const targetType = optionalString(record.targetType, 32)
  const materialId = optionalString(record.materialId, 191)
  const title = optionalString(record.title, 120)
  if (targetType !== MATERIAL_SHARE_TARGET_TYPE || !materialId || !title) return null
  const description = optionalString(record.description, 180) || optionalString(record.summary, 180)
  const imageUrl = typeof record.imageUrl === 'string' && record.imageUrl.trim()
    ? record.imageUrl.trim().slice(0, 1000)
    : null
  return {
    targetType: MATERIAL_SHARE_TARGET_TYPE,
    materialId,
    title,
    description,
    summary: description,
    authorName: optionalString(record.authorName, 80),
    imageUrl,
    status: optionalString(record.status, 40),
    statusLabel: optionalString(record.statusLabel, 40),
  }
}

export function materialSharePreview(snapshot: Pick<MaterialShareSnapshot, 'title'>) {
  return `[物料] ${snapshot.title || '分享了一份物料'}`
}

export function materialShareUrl(materialId: string) {
  return `/material-redemptions/${encodeURIComponent(materialId)}`
}

/** Client-side fallback data; the server share-card endpoint remains canonical. */
export function createMaterialShareCardData(input: MaterialShareCardInput): ShareCardData {
  return {
    type: 'material',
    contentId: input.id,
    title: input.title,
    description: input.description?.trim() || '来自私家E院的物料。',
    image: input.coverImageUrl?.trim() || null,
    url: canonicalShareUrl(materialShareUrl(input.id)),
    author: '私家E院',
    authorAvatar: null,
    date: input.publishedAt || null,
    meta: [
      ...(input.stateLabel ? [{ label: '状态', value: input.stateLabel }] : []),
      ...(typeof input.cost === 'number' ? [{ label: '费用', value: input.cost === 0 ? '免费兑换' : `${input.cost} 挂号费` }] : []),
    ],
  }
}
