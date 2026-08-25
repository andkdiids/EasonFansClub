import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const configuredDailyJobStaleMs = Number(process.env.DAILY_JOB_STALE_MS || 30 * 60 * 1000)
const dailyJobStaleMs = Number.isFinite(configuredDailyJobStaleMs) && configuredDailyJobStaleMs > 0
  ? configuredDailyJobStaleMs
  : 30 * 60 * 1000

export type DailyJobSkipReason = 'already_completed' | 'already_running'

export type DailyJobRunResult<T> =
  | { executed: true; status: 'completed'; value: T }
  | { executed: false; status: DailyJobSkipReason }

type DailyJobClaim = { runToken: string } | DailyJobSkipReason

export class DailyJobLeaseLostError extends Error {
  constructor(jobKey: string, dateKey: string) {
    super(`DAILY_JOB_LEASE_LOST:${jobKey}:${dateKey}`)
    this.name = 'DailyJobLeaseLostError'
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function serializeJobError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return message.slice(0, 4000)
}

async function claimDailyJob(jobKey: string, dateKey: string): Promise<DailyJobClaim> {
  const now = new Date()
  const runToken = randomUUID()
  try {
    await prisma.dailyJobExecution.create({
      data: { jobKey, dateKey, status: 'RUNNING', runToken, startedAt: now },
    })
    return { runToken }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
  }

  const existing = await prisma.dailyJobExecution.findUnique({
    where: { jobKey_dateKey: { jobKey, dateKey } },
    select: { status: true, startedAt: true, runToken: true },
  })
  if (!existing) return 'already_running'
  if (existing.status === 'SUCCEEDED') return 'already_completed'

  const staleBefore = new Date(now.getTime() - Math.max(dailyJobStaleMs, 60_000))
  const takeover = await prisma.dailyJobExecution.updateMany({
    where: {
      jobKey,
      dateKey,
      OR: [
        { status: 'FAILED', runToken: existing.runToken },
        { status: 'RUNNING', startedAt: { lt: staleBefore }, runToken: existing.runToken },
      ],
    },
    data: {
      status: 'RUNNING',
      runToken,
      startedAt: now,
      finishedAt: null,
      error: null,
    },
  })
  if (takeover.count === 1) return { runToken }

  const current = await prisma.dailyJobExecution.findUnique({
    where: { jobKey_dateKey: { jobKey, dateKey } },
    select: { status: true },
  })
  return current?.status === 'SUCCEEDED' ? 'already_completed' : 'already_running'
}

async function finishDailyJob(jobKey: string, dateKey: string, runToken: string, status: 'SUCCEEDED' | 'FAILED', error?: string) {
  const result = await prisma.dailyJobExecution.updateMany({
    where: { jobKey, dateKey, runToken },
    data: {
      status,
      finishedAt: new Date(),
      error: error || null,
    },
  })
  if (result.count !== 1) throw new DailyJobLeaseLostError(jobKey, dateKey)
}

export async function runDailyJob<T>(input: {
  jobKey: string
  dateKey: string
  run: () => Promise<T>
}): Promise<DailyJobRunResult<T>> {
  const claimed = await claimDailyJob(input.jobKey, input.dateKey)
  if (typeof claimed === 'string') return { executed: false, status: claimed }

  try {
    const value = await input.run()
    await finishDailyJob(input.jobKey, input.dateKey, claimed.runToken, 'SUCCEEDED')
    return { executed: true, status: 'completed', value }
  } catch (error) {
    await finishDailyJob(input.jobKey, input.dateKey, claimed.runToken, 'FAILED', serializeJobError(error)).catch((updateError) => {
      console.error('[daily-job.execution.mark-failed]', {
        jobKey: input.jobKey,
        dateKey: input.dateKey,
        error: serializeJobError(updateError),
      })
    })
    throw error
  }
}
