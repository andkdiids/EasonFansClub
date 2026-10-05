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

export async function serializeTopicActivityFormSubmission(row: Submission) {
  const assets = await Promise.all(row.ImageAssets.map(serializeTopicActivityAsset))
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]))
  const schemaFields = new Map(asArray(asRecord(row.formSchemaSnapshot).fields).map((field) => {
    const value = asRecord(field)
    return [String(value.id || ''), value] as const
  }))
  const answers = asArray(row.answersSnapshot).map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const answer = raw as Record<string, unknown>
    const value = asArray(answer.value)
    if (answer.type === 'SINGLE_SELECT' || answer.type === 'MULTI_SELECT') {
      const field = schemaFields.get(String(answer.fieldId || ''))
      const options = asArray(field?.options).map(asRecord)
      const selected = answer.type === 'SINGLE_SELECT' ? (typeof answer.value === 'string' ? [answer.value] : []) : value.filter((item): item is string => typeof item === 'string')
      const labels = selected.flatMap((selectedValue) => {
        const option = options.find((candidate) => candidate.value === selectedValue)
        return typeof option?.label === 'string' ? [option.label] : []
      })
      return { ...answer, displayValue: labels.join('、') }
    }
    if (answer.type !== 'IMAGE') return answer
    return { ...answer, value: value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const asset = assetById.get(String((item as Record<string, unknown>).assetId || ''))
      return asset ? [asset] : []
    }) }
  })
  const replies = await Promise.all(row.Replies.map(async (reply) => ({
    id: reply.id,
    content: reply.content,
    sender: { id: reply.Sender.id, nickname: reply.Sender.nickname },
    createdAt: reply.createdAt.toISOString(),
    images: await Promise.all(reply.ImageAssets.map(serializeTopicActivityAsset)),
  })))
  return {
    id: row.id,
    activityId: row.activityId,
    userId: row.userId,
    status: row.status,
    formSchemaSnapshot: row.formSchemaSnapshot,
    answersSnapshot: answers,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() || null,
    rejectReason: row.rejectReason,
    ...(row.User ? { user: row.User } : {}),
    replies,
  }
}
