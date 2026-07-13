import type { ChangelogStatus, ChangelogType, Prisma } from '@prisma/client'

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

export type VersionBump = 'patch' | 'minor' | 'major'

export const changelogTypes = Object.keys(changelogTypeLabels) as ChangelogType[]
export const changelogStatuses = Object.keys(changelogStatusLabels) as ChangelogStatus[]

export const changelogSelect = {
  id: true,
  version: true,
  major: true,
  minor: true,
  patch: true,
  title: true,
  content: true,
  type: true,
  isMajor: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { uid: true, nickname: true } },
} satisfies Prisma.ChangelogSelect

type ChangelogItem = Prisma.ChangelogGetPayload<{ select: typeof changelogSelect }>

export function serializeChangelog(item: ChangelogItem) {
  return {
    ...item,
    typeLabel: changelogTypeLabels[item.type],
    statusLabel: changelogStatusLabels[item.status],
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

export function nextVersion(
  latest: { major: number; minor: number; patch: number } | null,
  bump: VersionBump,
) {
  if (!latest) {
    return { major: 1, minor: 0, patch: 0, version: 'v1.0.0' }
  }

  const next =
    bump === 'major'
      ? { major: latest.major + 1, minor: 0, patch: 0 }
      : bump === 'minor'
        ? { major: latest.major, minor: latest.minor + 1, patch: 0 }
        : { major: latest.major, minor: latest.minor, patch: latest.patch + 1 }

  return { ...next, version: `v${next.major}.${next.minor}.${next.patch}` }
}
