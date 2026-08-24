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

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function serializeJobError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return message.slice(0, 4000)
}

async function claimDailyJob(jobKey: string, dateKey: string): Promise<true | DailyJobSkipReason> {
  const now = new Date()
  try {
    await prisma.dailyJobExecution.create({
      data: { jobKey, dateKey, status: 'RUNNING', startedAt: now },
    })
    return true
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
  }

  const existing = await prisma.dailyJobExecution.findUnique({
    where: { jobKey_dateKey: { jobKey, dateKey } },
    select: { status: true, startedAt: true },
  })
  if (!existing) return 'already_running'
  if (existing.status === 'SUCCEEDED') return 'already_completed'

  const staleBefore = new Date(now.getTime() - Math.max(dailyJobStaleMs, 60_000))
  const takeover = await prisma.dailyJobExecution.updateMany({
    where: {
      jobKey,
      dateKey,
      OR: [
        { status: 'FAILED' },
        { status: 'RUNNING', startedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: 'RUNNING',
      startedAt: now,
      finishedAt: null,
      error: null,
    },
  })
  if (takeover.count === 1) return true

  const current = await prisma.dailyJobExecution.findUnique({
    where: { jobKey_dateKey: { jobKey, dateKey } },
    select: { status: true },
  })
  return current?.status === 'SUCCEEDED' ? 'already_completed' : 'already_running'
}

export async function runDailyJob<T>(input: {
  jobKey: string
  dateKey: string
  run: () => Promise<T>
}): Promise<DailyJobRunResult<T>> {
  const claimed = await claimDailyJob(input.jobKey, input.dateKey)
  if (claimed !== true) return { executed: false, status: claimed }

  try {
    const value = await input.run()
    await prisma.dailyJobExecution.update({
      where: { jobKey_dateKey: { jobKey: input.jobKey, dateKey: input.dateKey } },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), error: null },
    })
    return { executed: true, status: 'completed', value }
  } catch (error) {
    await prisma.dailyJobExecution.update({
      where: { jobKey_dateKey: { jobKey: input.jobKey, dateKey: input.dateKey } },
      data: { status: 'FAILED', finishedAt: new Date(), error: serializeJobError(error) },
    }).catch((updateError) => {
      console.error('[daily-job.execution.mark-failed]', {
        jobKey: input.jobKey,
        dateKey: input.dateKey,
        error: serializeJobError(updateError),
      })
    })
    throw error
  }
}
