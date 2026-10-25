import {
  createDefaultTopicActivityV2Program,
  readTopicActivityV2Program,
  type TopicActivityV2Poll,
  type TopicActivityV2Program,
  type TopicActivityV2Test,
  type TopicActivityV2TestQuestion,
  type TopicActivityV2TestResult,
  type TopicRewardEntryConfig,
} from '@/lib/topic-activity-v2-config'

export type {
  TopicActivityV2Poll,
  TopicActivityV2Program,
  TopicActivityV2Test,
  TopicActivityV2TestQuestion,
  TopicActivityV2TestResult,
  TopicRewardEntryConfig,
}

export type TopicActivityV2RewardEntry = TopicRewardEntryConfig
export type TopicActivityV2EntryStatus = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'GRANTED' | 'UNAVAILABLE'

export type TopicActivityV2EntryProgress = {
  rewardEntryId: string
  status: TopicActivityV2EntryStatus
  submissionId?: string | null
  commentId?: string | null
  rejectReason?: string | null
  granted?: boolean
  submittedAt?: string | null
  reviewedAt?: string | null
  grantedPoints?: number | null
}

export type TopicActivityV2PublicPayload = {
  program?: unknown
  entries?: unknown
  myProgress?: unknown
  canReview?: boolean
}

export type TopicActivityV2TaskAsset = {
  assetId: string
  previewAccessUrl?: string | null
  thumbnailAccessUrl?: string | null
  originalDownloadUrl?: string | null
  url?: string | null
  thumbnailUrl?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  size?: number | null
}

export type TopicActivityV2TaskSubmission = {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
  rewardEntryId?: string | null
  rewardSnapshotSafe?: {
    platformName?: string | null
    title?: string | null
    points?: number | null
    instructions?: string | null
  } | null
  taskAssets?: TopicActivityV2TaskAsset[]
  granted?: boolean
  rejectReason?: string | null
}

export function createEmptyTopicActivityV2Program(): TopicActivityV2Program {
  return createDefaultTopicActivityV2Program()
}

export function normalizeTopicActivityV2Program(value: unknown): TopicActivityV2Program {
  return readTopicActivityV2Program(value) || createDefaultTopicActivityV2Program()
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asEntry(value: unknown): TopicActivityV2RewardEntry | null {
  const source = record(value)
  const id = typeof source.id === 'string' ? source.id : typeof source.key === 'string' ? source.key : ''
  const platformKey = typeof source.platformKey === 'string' ? source.platformKey : ''
  if (!id || !platformKey) return null
  return {
    id,
    platformKey,
    platformName: typeof source.platformName === 'string' ? source.platformName : '',
    title: typeof source.title === 'string' ? source.title : '',
    instructions: typeof source.instructions === 'string' ? source.instructions : typeof source.task === 'string' ? source.task : '',
    materialRequirement: typeof source.materialRequirement === 'string' ? source.materialRequirement : '',
    minImages: typeof source.minImages === 'number' ? source.minImages : typeof source.screenshotMin === 'number' ? source.screenshotMin : 0,
    maxImages: typeof source.maxImages === 'number' ? source.maxImages : typeof source.screenshotMax === 'number' ? source.screenshotMax : 0,
    points: typeof source.points === 'number' ? source.points : 0,
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    sortOrder: typeof source.sortOrder === 'number' ? source.sortOrder : 0,
    startsAt: typeof source.startsAt === 'string' ? source.startsAt : null,
    endsAt: typeof source.endsAt === 'string' ? source.endsAt : null,
    allowResubmit: typeof source.allowResubmit === 'boolean' ? source.allowResubmit : false,
  }
}

export function normalizeTopicActivityV2Entries(value: unknown): TopicActivityV2RewardEntry[] {
  const raw = Array.isArray(value) ? value : record(value).entries
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => { const entry = asEntry(item); return entry ? [entry] : [] })
}

export function normalizeTopicActivityV2Progress(value: unknown): TopicActivityV2EntryProgress[] {
  const source = record(value)
  const submissions = Array.isArray(source.submissions) ? source.submissions : Array.isArray(value) ? value : []
  const latestByEntry = new Map<string, TopicActivityV2EntryProgress>()
  for (const item of submissions) {
    const row = record(item)
    const rewardEntryId = typeof row.rewardEntryId === 'string' ? row.rewardEntryId : ''
    if (!rewardEntryId) continue
    const rawStatus = typeof row.status === 'string' ? row.status : 'NOT_STARTED'
    const status: TopicActivityV2EntryStatus = ['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'GRANTED', 'UNAVAILABLE'].includes(rawStatus) ? rawStatus as TopicActivityV2EntryStatus : 'UNAVAILABLE'
    const current = latestByEntry.get(rewardEntryId)
    const nextSubmittedAt = typeof row.submittedAt === 'string' ? Date.parse(row.submittedAt) : NaN
    const currentSubmittedAt = current?.submittedAt ? Date.parse(current.submittedAt) : NaN
    const currentDurable = current?.status === 'APPROVED' || current?.status === 'GRANTED'
    const nextDurable = status === 'APPROVED' || status === 'GRANTED'
    const nextIsNewer = Number.isFinite(nextSubmittedAt) && Number.isFinite(currentSubmittedAt) && nextSubmittedAt > currentSubmittedAt
    // Successful review/grant history remains the effective progress state;
    // otherwise the newest attempt wins (including a withdrawal).
    if (!current || (nextDurable && !currentDurable) || (nextDurable === currentDurable && !currentDurable && nextIsNewer)) {
      latestByEntry.set(rewardEntryId, { rewardEntryId, status, submissionId: typeof row.id === 'string' ? row.id : null, commentId: typeof row.commentId === 'string' ? row.commentId : null, rejectReason: typeof row.rejectReason === 'string' ? row.rejectReason : null, submittedAt: typeof row.submittedAt === 'string' ? row.submittedAt : null, reviewedAt: typeof row.reviewedAt === 'string' ? row.reviewedAt : null, granted: status === 'GRANTED' })
    }
  }
  const grants = Array.isArray(source.grants) ? source.grants : []
  for (const item of grants) {
    const row = record(item)
    const rewardEntryId = typeof row.rewardEntryId === 'string' ? row.rewardEntryId : ''
    if (!rewardEntryId) continue
    const current = latestByEntry.get(rewardEntryId)
    if (row.status === 'GRANTED') latestByEntry.set(rewardEntryId, { ...(current || { rewardEntryId, status: 'APPROVED' }), status: 'GRANTED', granted: true,
      grantedPoints: row.kind === 'POINTS' && typeof row.points === 'number' && Number.isFinite(row.points) ? (current?.grantedPoints ?? 0) + row.points : current?.grantedPoints ?? null })
  }
  return [...latestByEntry.values()]
}

export function canSubmitTopicActivityV2Entry(status: TopicActivityV2EntryStatus, allowResubmit: boolean): boolean {
  return status === 'NOT_STARTED' || status === 'WITHDRAWN' || (status === 'REJECTED' && allowResubmit)
}
