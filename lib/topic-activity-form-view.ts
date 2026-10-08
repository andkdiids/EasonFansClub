import { serializeTopicActivityAsset, type TopicActivityAssetRecord } from '@/lib/topic-activity-assets'

type Asset = TopicActivityAssetRecord & { id: string }
type Reply = { id: string; content: string | null; createdAt: Date; Sender: { id: string; nickname: string }; ImageAssets: Asset[] }
type Submission = {
  id: string
  activityId: string
  userId: string
  status: string
  formSchemaSnapshot: unknown
  answersSnapshot: unknown
  submittedAt: Date
  reviewedAt: Date | null
  rejectReason: string | null
  User?: { id: string; nickname: string; avatarUrl: string | null }
  ImageAssets: Asset[]
  Replies: Reply[]
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function safeString(value: unknown, maxLength = 8_000) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

const PRIVATE_MEDIA_KEYS = new Set(['storageKey', 'originalObjectKey', 'sourceUrl', 'originalUrl', 'signedUrl', 'url', 'thumbnailUrl', 'previewUrl', 'downloadUrl', 'originalDownloadUrl'])

/** Form snapshots are treated as untrusted response data. */
function safeJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return null
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return value.slice(0, 8_000)
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeJson(item, depth + 1))
  if (typeof value !== 'object') return null
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (PRIVATE_MEDIA_KEYS.has(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    Object.defineProperty(output, key.slice(0, 120), { value: safeJson(item, depth + 1), enumerable: true, writable: true, configurable: true })
  }
  return output
}

function safeUser(user: Submission['User']) {
  if (!user) return null
  return { id: safeString(user.id, 191), nickname: safeString(user.nickname, 160), avatarUrl: user.avatarUrl ? safeString(user.avatarUrl, 2_000) : null }
}

export async function serializeTopicActivityFormSubmission(row: Submission) {
  const sourceDownloadContext = { activityId: row.activityId, submissionId: row.id, purpose: 'FORM_ANSWER' as const }
  const assets = await Promise.all(row.ImageAssets.map((asset) => serializeTopicActivityAsset(asset, sourceDownloadContext)))
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]))
  const schemaSnapshot = safeJson(row.formSchemaSnapshot)
  const schemaFields = new Map(asArray(asRecord(schemaSnapshot).fields).map((field) => {
    const value = asRecord(field)
    return [safeString(value.id, 191), value] as const
  }))
  const answers: Array<{ fieldId: string; label: string; type: string; value: unknown; displayValue?: string }> = asArray(row.answersSnapshot).flatMap((raw): Array<{ fieldId: string; label: string; type: string; value: unknown; displayValue?: string }> => {
    const answer = asRecord(raw)
    if (!Object.keys(answer).length) return []
    const fieldId = safeString(answer.fieldId, 191)
    const label = safeString(answer.label, 500)
    const type = safeString(answer.type, 40)
    const value = asArray(answer.value)
    if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') {
      const field = schemaFields.get(fieldId)
      const options = asArray(field?.options).map(asRecord)
      const selected = type === 'SINGLE_SELECT'
        ? (typeof answer.value === 'string' ? [answer.value] : [])
        : value.filter((item): item is string => typeof item === 'string').slice(0, 100)
      const labels = selected.flatMap((selectedValue) => {
        const option = options.find((candidate) => candidate.value === selectedValue)
        return typeof option?.label === 'string' ? [option.label.slice(0, 500)] : []
      })
      return [{ fieldId, label, type, value: type === 'SINGLE_SELECT' ? safeString(answer.value, 500) : selected, displayValue: labels.join('、') }]
    }
    if (type === 'IMAGE') {
      const resolved = value.flatMap((item) => {
        const asset = assetById.get(safeString(asRecord(item).assetId, 191))
        return asset ? [asset] : []
      })
      return [{ fieldId, label, type, value: resolved }]
    }
    const primitive = typeof answer.value === 'string'
      ? safeString(answer.value)
      : Array.isArray(answer.value) ? answer.value.filter((item): item is string => typeof item === 'string').slice(0, 100).map((item) => item.slice(0, 8_000)) : ''
    return [{ fieldId, label, type, value: primitive }]
  })
  const fieldImageIds = new Set(asArray(row.answersSnapshot).flatMap((raw) => {
    const answer = asRecord(raw)
    return safeString(answer.type, 40) === 'IMAGE' ? asArray(answer.value).map((item) => safeString(asRecord(item).assetId, 191)) : []
  }))
  const replies = await Promise.all(row.Replies.map(async (reply) => {
    const downloadContext = { activityId: row.activityId, submissionId: row.id, replyId: reply.id, purpose: 'ADMIN_REPLY' as const }
    return {
    id: safeString(reply.id, 191),
    content: reply.content ? safeString(reply.content) : null,
    sender: { id: safeString(reply.Sender.id, 191), nickname: safeString(reply.Sender.nickname, 160) },
    createdAt: reply.createdAt.toISOString(),
    images: await Promise.all(reply.ImageAssets.map((asset) => serializeTopicActivityAsset(asset, downloadContext))),
  }
  }))
  return {
    id: safeString(row.id, 191),
    activityId: safeString(row.activityId, 191),
    userId: safeString(row.userId, 191),
    status: row.Replies.length ? 'REPLIED' : 'SUBMITTED',
    formSchemaSnapshot: schemaSnapshot,
    answersSnapshot: answers,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: null,
    rejectReason: null,
    ...(row.User ? { user: safeUser(row.User) } : {}),
    replies,
    attachments: assets.filter((asset) => !fieldImageIds.has(asset.assetId)),
  }
}
