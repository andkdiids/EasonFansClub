import { Prisma } from '@prisma/client'

import { scanAllContentForModeration, type ModerationScanSummary } from '@/lib/content-moderation-scan'
import { prisma } from '@/lib/prisma'

export type ModerationScanJob = {
  id: string
  status: 'SCANNING' | 'COMPLETED' | 'FAILED'
  summary: ModerationScanSummary | null
  error: string | null
  createdAt: string
  completedAt: string | null
}

const STALE_JOB_AFTER_MS = 6 * 60 * 60 * 1000
const jobs = new Map<string, ModerationScanJob>()
let activeJobId: string | null = null

function serializeJob(row: {
  id: string
  status: 'SCANNING' | 'COMPLETED' | 'FAILED'
  summary: Prisma.JsonValue | null
  error: string | null
  createdAt: Date
  completedAt: Date | null
}): ModerationScanJob {
  return {
    id: row.id,
    status: row.status,
    summary: row.summary && typeof row.summary === 'object' ? row.summary as ModerationScanSummary : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() || null,
  }
}

async function persistJob(id: string, data: {
  status: 'SCANNING' | 'COMPLETED' | 'FAILED'
  summary?: Prisma.InputJsonValue
  error?: string | null
  completedAt?: Date | null
}) {
  try {
    await prisma.contentModerationScanJob.update({ where: { id }, data })
  } catch (error) {
    console.error('[content-moderation:job-persist]', error)
  }
}

export async function startModerationScan() {
  if (activeJobId) {
    const active = jobs.get(activeJobId)
    if (active?.status === 'SCANNING') return active
  }

  const staleBefore = new Date(Date.now() - STALE_JOB_AFTER_MS)
  await prisma.contentModerationScanJob.updateMany({
    where: { status: 'SCANNING', createdAt: { lt: staleBefore } },
    data: { status: 'FAILED', error: '扫描任务超过 6 小时未完成，请重新扫描。', completedAt: new Date() },
  })
  const existing = await prisma.contentModerationScanJob.findFirst({
    where: { status: 'SCANNING' },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    const job = serializeJob(existing)
    jobs.set(job.id, job)
    activeJobId = job.id
    return job
  }

  const created = await prisma.contentModerationScanJob.create({ data: {}, select: { id: true, status: true, summary: true, error: true, createdAt: true, completedAt: true } })
  const job = serializeJob(created)
  activeJobId = job.id
  jobs.set(job.id, job)

  void scanAllContentForModeration()
    .then(async (summary) => {
      await persistJob(job.id, {
        status: 'COMPLETED',
        summary: summary as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      })
      job.status = 'COMPLETED'
      job.summary = summary
      job.completedAt = new Date().toISOString()
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : '扫描失败'
      await persistJob(job.id, { status: 'FAILED', error: message, completedAt: new Date() })
      job.status = 'FAILED'
      job.error = message
      job.completedAt = new Date().toISOString()
    })
    .finally(() => {
      if (activeJobId === job.id) activeJobId = null
    })

  return job
}

export async function getModerationScanJob(id: string) {
  try {
    const row = await prisma.contentModerationScanJob.findUnique({
      where: { id },
      select: { id: true, status: true, summary: true, error: true, createdAt: true, completedAt: true },
    })
    if (row) {
      const job = serializeJob(row)
      jobs.set(job.id, job)
      return job
    }
  } catch (error) {
    console.error('[content-moderation:job-read]', error)
  }
  return jobs.get(id) || null
}
