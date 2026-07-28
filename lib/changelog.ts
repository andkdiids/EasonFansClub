import type { Prisma } from '@prisma/client'
import { systemNotificationSelect, systemNotificationTypeLabels } from '@/lib/system-notifications'

export type ChangelogStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
export type ChangelogType = 'FEATURE' | 'IMPROVEMENT' | 'FIX' | 'SECURITY' | 'CONTENT'
export type VersionBump = 'patch' | 'minor' | 'major'

export const changelogTypeLabels: Record<ChangelogType, string> = {
  FEATURE: '新功能',
  IMPROVEMENT: '功能优化',
  FIX: '问题修复',
  SECURITY: '安全更新',
  CONTENT: '内容更新',
}

export const changelogStatusLabels: Record<ChangelogStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
}

export const changelogTypes = Object.keys(changelogTypeLabels) as ChangelogType[]
export const changelogStatuses = Object.keys(changelogStatusLabels) as ChangelogStatus[]
export const changelogSelect = systemNotificationSelect

type ChangelogItem = Prisma.SystemNotificationGetPayload<{ select: typeof systemNotificationSelect }>

export function serializeChangelog(item: ChangelogItem) {
  const status: ChangelogStatus = item.published ? 'PUBLISHED' : 'DRAFT'
  const changelogType = mapSystemTypeToChangelogType(item.type)
  const [major, minor, patch] = parseVersionParts(item.version)
  return {
    id: item.id,
    version: item.version || 'v0.0.0',
    major,
    minor,
    patch,
    title: item.title,
    content: item.content,
    type: changelogType,
    typeLabel: changelogTypeLabels[changelogType] || systemNotificationTypeLabels.UPDATE,
    isMajor: item.priority >= 80,
    status,
    statusLabel: changelogStatusLabels[status],
    publishedAt: item.publishAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: item.User,
  }
}

export function parseChangelogType(value: unknown): ChangelogType {
  const type = String(value || '').toUpperCase()
  return changelogTypes.includes(type as ChangelogType) ? (type as ChangelogType) : 'IMPROVEMENT'
}

export function parseChangelogStatus(value: unknown): ChangelogStatus | null {
  const status = String(value || '').toUpperCase()
  return changelogStatuses.includes(status as ChangelogStatus) ? (status as ChangelogStatus) : null
}

export function parseVersionBump(value: unknown): VersionBump {
  return value === 'major' || value === 'minor' || value === 'patch' ? value : 'patch'
}

export function parseVersionParts(version?: string | null) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version || '')
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] as const : [0, 0, 0] as const
}

export function nextVersion(latest: { version?: string | null } | null, bump: VersionBump) {
  const [currentMajor, currentMinor, currentPatch] = parseVersionParts(latest?.version || null)
  if (!latest || !latest.version) return { major: 1, minor: 0, patch: 0, version: 'v1.0.0' }

  const next =
    bump === 'major'
      ? { major: currentMajor + 1, minor: 0, patch: 0 }
      : bump === 'minor'
        ? { major: currentMajor, minor: currentMinor + 1, patch: 0 }
        : { major: currentMajor, minor: currentMinor, patch: currentPatch + 1 }

  return { ...next, version: `v${next.major}.${next.minor}.${next.patch}` }
}

export function mapChangelogTypeToPriority(type: ChangelogType, isMajor: boolean) {
  if (isMajor) return 90
  if (type === 'SECURITY') return 80
  if (type === 'FEATURE') return 60
  return 40
}

function mapSystemTypeToChangelogType(type: string): ChangelogType {
  if (type === 'SECURITY') return 'SECURITY'
  if (type === 'ACTIVITY') return 'CONTENT'
  return 'IMPROVEMENT'
}
