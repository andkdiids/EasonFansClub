import { revalidatePath, revalidateTag } from 'next/cache'
import type { Prisma } from '@prisma/client'
import {
  getDefaultPageLayoutConfig,
  getPageLayoutPagePath,
  getPageLayoutRegistry,
  isPageLayoutPageKey,
  pageLayoutPages,
} from '@/lib/page-layout/registry'
import type { PageLayoutConfig, PageLayoutPageKey, SerializedPageLayout, SerializedPageLayoutRevision } from '@/lib/page-layout/types'
import { PageLayoutValidationError, repairPageLayoutConfig, validatePageLayoutConfig } from '@/lib/page-layout/validation'
import { prisma } from '@/lib/prisma'

const pageLayoutCacheTagPrefix = 'page-layout'
export class PageLayoutNotFoundError extends Error {
  constructor() {
    super('页面不存在')
    this.name = 'PageLayoutNotFoundError'
  }
}

export class PageLayoutVersionConflictError extends Error {
  constructor() {
    super('页面布局已被其他管理员修改，请刷新后重试。')
    this.name = 'PageLayoutVersionConflictError'
  }
}

export class PageLayoutRevisionNotFoundError extends Error {
  constructor() {
    super('页面布局版本不存在')
    this.name = 'PageLayoutRevisionNotFoundError'
  }
}

export function assertPageLayoutPageKey(value: string): PageLayoutPageKey {
  if (!isPageLayoutPageKey(value)) throw new PageLayoutNotFoundError()
  return value
}

function toJson(config: PageLayoutConfig): Prisma.InputJsonValue {
  return config as unknown as Prisma.InputJsonValue
}

function fromJson(pageKey: PageLayoutPageKey, value: unknown) {
  return repairPageLayoutConfig(pageKey, value)
}

function serializeRevision(pageKey: PageLayoutPageKey, revision: {
  id: string
  pageLayoutId: string
  version: number
  config: unknown
  note?: string | null
  source: 'MANUAL' | 'ROLLBACK' | 'DEFAULT'
  createdAt: Date
  publishedById?: string | null
  publishedBy?: {
    nickname: string
    username: string
    profile?: { displayName: string | null } | null
  } | null
}): SerializedPageLayoutRevision {
  return {
    id: revision.id,
    pageKey,
    pageLayoutId: revision.pageLayoutId,
    version: revision.version,
    config: fromJson(pageKey, revision.config),
    note: revision.note || null,
    source: revision.source,
    createdAt: revision.createdAt.toISOString(),
    publishedById: revision.publishedById || null,
    publishedByName: revision.publishedBy?.profile?.displayName || revision.publishedBy?.nickname || revision.publishedBy?.username || null,
  }
}

function serializeLayout(pageKey: PageLayoutPageKey, layout: {
  draftConfig: unknown
  publishedConfig: unknown
  previousPublishedConfig?: unknown
  version: number
  updatedAt?: Date | null
  publishedAt?: Date | null
  updatedById?: string | null
  publishedById?: string | null
} | null): SerializedPageLayout {
  const defaults = getDefaultPageLayoutConfig(pageKey)
  return {
    pageKey,
    registry: getPageLayoutRegistry(pageKey).map((item) => ({ ...item })),
    defaults,
    draftConfig: layout ? fromJson(pageKey, layout.draftConfig) : defaults,
    publishedConfig: layout ? fromJson(pageKey, layout.publishedConfig) : defaults,
    previousPublishedConfig: layout?.previousPublishedConfig ? fromJson(pageKey, layout.previousPublishedConfig) : null,
    version: layout?.version || 1,
    updatedAt: layout?.updatedAt ? layout.updatedAt.toISOString() : null,
    publishedAt: layout?.publishedAt ? layout.publishedAt.toISOString() : null,
    updatedById: layout?.updatedById || null,
    publishedById: layout?.publishedById || null,
  }
}

async function loadPageLayoutRow(pageKey: PageLayoutPageKey) {
  return prisma.pageLayout.findUnique({
    where: { pageKey },
    select: {
      draftConfig: true,
      publishedConfig: true,
      previousPublishedConfig: true,
      version: true,
      updatedAt: true,
      publishedAt: true,
      updatedById: true,
      publishedById: true,
    },
  })
}

const layoutSelect = {
  draftConfig: true,
  publishedConfig: true,
  previousPublishedConfig: true,
  version: true,
  updatedAt: true,
  publishedAt: true,
  updatedById: true,
  publishedById: true,
} satisfies Prisma.PageLayoutSelect

export async function getAdminPageLayout(pageKey: PageLayoutPageKey) {
  return serializeLayout(pageKey, await loadPageLayoutRow(pageKey))
}

export async function listPageLayoutRevisions(pageKey: PageLayoutPageKey, limit = 20) {
  const layout = await prisma.pageLayout.findUnique({
    where: { pageKey },
    select: { id: true },
  })
  if (!layout) return []

  const revisions = await prisma.pageLayoutRevision.findMany({
    where: { pageLayoutId: layout.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 50),
    include: {
      publishedBy: {
        select: {
          nickname: true,
          username: true,
          profile: { select: { displayName: true } },
        },
      },
    },
  })

  return revisions.map((revision) => serializeRevision(pageKey, revision))
}

export async function getPageLayoutRevision(pageKey: PageLayoutPageKey, revisionId: string) {
  const layout = await prisma.pageLayout.findUnique({
    where: { pageKey },
    select: { id: true },
  })
  if (!layout) throw new PageLayoutRevisionNotFoundError()

  const revision = await prisma.pageLayoutRevision.findFirst({
    where: { id: revisionId, pageLayoutId: layout.id },
    include: {
      publishedBy: {
        select: {
          nickname: true,
          username: true,
          profile: { select: { displayName: true } },
        },
      },
    },
  })
  if (!revision) throw new PageLayoutRevisionNotFoundError()

  return serializeRevision(pageKey, revision)
}

async function getPublishedPageLayoutUncached(pageKey: PageLayoutPageKey) {
  const layout = await loadPageLayoutRow(pageKey)
  const defaults = getDefaultPageLayoutConfig(pageKey)
  return layout ? fromJson(pageKey, layout.publishedConfig) : defaults
}

export async function getPublishedPageLayoutConfig(pageKey: PageLayoutPageKey) {
  return getPublishedPageLayoutUncached(pageKey)
}

export function getPageLayoutCacheTag(pageKey: PageLayoutPageKey) {
  return `${pageLayoutCacheTagPrefix}:${pageKey}`
}

export function revalidatePageLayout(pageKey: PageLayoutPageKey) {
  revalidateTag(`${pageLayoutCacheTagPrefix}:all`)
  revalidateTag(getPageLayoutCacheTag(pageKey))
  revalidatePath(getPageLayoutPagePath(pageKey), 'page')
}

export async function savePageLayoutDraft(pageKey: PageLayoutPageKey, rawConfig: unknown, version: number, adminId: string) {
  const draftConfig = validatePageLayoutConfig(pageKey, rawConfig)
  const existing = await loadPageLayoutRow(pageKey)

  if (!existing) {
    const created = await prisma.pageLayout.create({
      data: {
        pageKey,
        draftConfig: toJson(draftConfig),
        publishedConfig: toJson(getDefaultPageLayoutConfig(pageKey)),
        version: 1,
        updatedById: adminId,
      },
      select: {
        draftConfig: true,
        publishedConfig: true,
        previousPublishedConfig: true,
        version: true,
        updatedAt: true,
        publishedAt: true,
        updatedById: true,
        publishedById: true,
      },
    })
    return serializeLayout(pageKey, created)
  }

  if (existing.version !== version) throw new PageLayoutVersionConflictError()

  const updated = await prisma.pageLayout.update({
    where: { pageKey },
    data: {
      draftConfig: toJson(draftConfig),
      version: { increment: 1 },
      updatedById: adminId,
    },
    select: {
      draftConfig: true,
      publishedConfig: true,
      previousPublishedConfig: true,
      version: true,
      updatedAt: true,
      publishedAt: true,
      updatedById: true,
      publishedById: true,
    },
  })

  return serializeLayout(pageKey, updated)
}

export async function publishPageLayout(pageKey: PageLayoutPageKey, version: number, adminId: string, rawConfig?: unknown) {
  const existing = await prisma.pageLayout.findUnique({
    where: { pageKey },
    select: { id: true, draftConfig: true, publishedConfig: true, version: true },
  })

  let published: Prisma.PageLayoutGetPayload<{ select: typeof layoutSelect }>
  let revisionConfig: PageLayoutConfig
  let revisionNote: string | undefined
  let revisionPageLayoutId: string

  if (!existing) {
    const defaultConfig = rawConfig === undefined ? getDefaultPageLayoutConfig(pageKey) : validatePageLayoutConfig(pageKey, rawConfig)
    const created = await prisma.pageLayout.create({
      data: {
        pageKey,
        draftConfig: toJson(defaultConfig),
        publishedConfig: toJson(defaultConfig),
        version: 2,
        publishedAt: new Date(),
        updatedById: adminId,
        publishedById: adminId,
      },
      select: { id: true, ...layoutSelect },
    })
    published = created
    revisionConfig = defaultConfig
    revisionNote = 'Initial default layout publish'
    revisionPageLayoutId = created.id
  } else {
    if (existing.version !== version) throw new PageLayoutVersionConflictError()
    const draftConfig = validatePageLayoutConfig(pageKey, rawConfig === undefined ? existing.draftConfig : rawConfig)

    published = await prisma.pageLayout.update({
      where: { pageKey },
      data: {
        draftConfig: toJson(draftConfig),
        publishedConfig: toJson(draftConfig),
        previousPublishedConfig: existing.publishedConfig as Prisma.InputJsonValue,
        version: { increment: 1 },
        publishedAt: new Date(),
        updatedById: adminId,
        publishedById: adminId,
      },
      select: layoutSelect,
    })
    revisionConfig = draftConfig
    revisionPageLayoutId = existing.id
  }

  prisma.pageLayoutRevision
    .create({
      data: {
        pageLayoutId: revisionPageLayoutId,
        version: published.version,
        config: toJson(revisionConfig),
        publishedById: adminId,
        source: 'MANUAL',
        note: revisionNote,
      },
    })
    .catch((error) => {
      console.error('[pageLayout.revision]', error)
    })

  prisma.adminAction
    .create({
      data: {
        adminId,
        action: 'UPDATE_SETTING',
        reason: `Publish page layout: ${pageLayoutPages[pageKey].name}`,
        metadata: { pageKey, version: published.version },
      },
    })
    .catch((error) => {
      console.error('[pageLayout.adminAction]', error)
    })

  revalidatePageLayout(pageKey)
  return serializeLayout(pageKey, published)
}

export async function resetPageLayoutDraft(pageKey: PageLayoutPageKey, version: number, adminId: string) {
  return savePageLayoutDraft(pageKey, getDefaultPageLayoutConfig(pageKey), version, adminId)
}

export async function restorePageLayoutRevisionToDraft(pageKey: PageLayoutPageKey, revisionId: string, version: number, adminId: string) {
  const restored = await prisma.$transaction(async (tx) => {
    const existing = await tx.pageLayout.findUnique({
      where: { pageKey },
      select: { id: true, version: true },
    })
    if (!existing) throw new PageLayoutRevisionNotFoundError()
    if (existing.version !== version) throw new PageLayoutVersionConflictError()

    const revision = await tx.pageLayoutRevision.findFirst({
      where: { id: revisionId, pageLayoutId: existing.id },
      select: { version: true, config: true },
    })
    if (!revision) throw new PageLayoutRevisionNotFoundError()

    const draftConfig = repairPageLayoutConfig(pageKey, revision.config)
    const updated = await tx.pageLayout.update({
      where: { pageKey },
      data: {
        draftConfig: toJson(draftConfig),
        version: { increment: 1 },
        updatedById: adminId,
      },
      select: layoutSelect,
    })

    await tx.adminAction.create({
      data: {
        adminId,
        action: 'UPDATE_SETTING',
        reason: `Restore page layout draft: ${pageLayoutPages[pageKey].name}`,
        metadata: { pageKey, revisionVersion: revision.version },
      },
    })

    return updated
  })

  return serializeLayout(pageKey, restored)
}

export async function publishPageLayoutRevision(pageKey: PageLayoutPageKey, revisionId: string, version: number, adminId: string) {
  const published = await prisma.$transaction(async (tx) => {
    const existing = await tx.pageLayout.findUnique({
      where: { pageKey },
      select: { id: true, publishedConfig: true, version: true },
    })
    if (!existing) throw new PageLayoutRevisionNotFoundError()
    if (existing.version !== version) throw new PageLayoutVersionConflictError()

    const revision = await tx.pageLayoutRevision.findFirst({
      where: { id: revisionId, pageLayoutId: existing.id },
      select: { version: true, config: true },
    })
    if (!revision) throw new PageLayoutRevisionNotFoundError()

    const config = repairPageLayoutConfig(pageKey, revision.config)
    const next = await tx.pageLayout.update({
      where: { pageKey },
      data: {
        draftConfig: toJson(config),
        publishedConfig: toJson(config),
        previousPublishedConfig: existing.publishedConfig as Prisma.InputJsonValue,
        version: { increment: 1 },
        publishedAt: new Date(),
        updatedById: adminId,
        publishedById: adminId,
      },
    })

    await tx.pageLayoutRevision.create({
      data: {
        pageLayoutId: existing.id,
        version: next.version,
        config: toJson(config),
        publishedById: adminId,
        source: 'ROLLBACK',
        note: `Publish from revision v${revision.version}`,
      },
    })

    await tx.adminAction.create({
      data: {
        adminId,
        action: 'UPDATE_SETTING',
        reason: `Rollback publish page layout: ${pageLayoutPages[pageKey].name}`,
        metadata: { pageKey, fromRevisionVersion: revision.version, version: next.version },
      },
    })

    return next
  })

  revalidatePageLayout(pageKey)
  return serializeLayout(pageKey, published)
}

export function pageLayoutErrorResponse(error: unknown) {
  if (error instanceof PageLayoutNotFoundError) {
    return { status: 404, body: { message: error.message, code: 'LAYOUT_PAGE_NOT_FOUND' } }
  }
  if (error instanceof PageLayoutRevisionNotFoundError) {
    return { status: 404, body: { message: error.message, code: 'LAYOUT_REVISION_NOT_FOUND' } }
  }
  if (error instanceof PageLayoutVersionConflictError) {
    return { status: 409, body: { message: error.message, code: 'LAYOUT_VERSION_CONFLICT' } }
  }
  if (error instanceof PageLayoutValidationError) {
    const firstDetail = Object.values(error.details)[0]
    return { status: 400, body: { message: firstDetail || error.message, code: 'LAYOUT_VALIDATION_FAILED', errors: error.details } }
  }
  return { status: 500, body: { message: '页面布局操作失败', code: 'LAYOUT_OPERATION_FAILED' } }
}
