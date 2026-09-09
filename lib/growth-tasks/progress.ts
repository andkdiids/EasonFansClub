import { getShanghaiDateKey, shiftShanghaiDateKey } from '@/lib/checkin'
import {
  TASK_SYSTEM_GRACE_DATE_KEY,
  TASK_SYSTEM_GRACE_WEEK_KEY,
  getActiveActionTasks,
  getCoreActiveTasks,
  getTodayTasks,
  type GrowthTaskCode,
  type GrowthTaskDefinition,
} from './registry'

export type GrowthCompletionDayRow = Readonly<{
  taskCode: string
  periodKey: string
}>

/**
 * Business facts are intentionally read-only inputs to the resolver. They
 * repair visibility when a feature action happened before its growth row was
 * created; they never create a completion row or grant a reward.
 */
export type GrowthBusinessCompletionFacts = Readonly<{
  checkinDateKeys?: Iterable<string>
  prescriptionDateKeys?: Iterable<string>
  commentRewardCountsByDate?: ReadonlyMap<string, number>
  gameCompletionCountsByDate?: ReadonlyMap<string, number>
  /** Counts for the action-surface daily tasks, keyed by date then task code. */
  actionProgressCountsByDate?: ReadonlyMap<string, ReadonlyMap<string, number>>
}>

export type GrowthActionProgressRow = Readonly<{
  taskCode: GrowthTaskCode
  progress: number
  earned: number
  cap: number
}>

export type GrowthTodayTaskStatus = Readonly<{
  code: GrowthTaskCode
  completed: boolean
  progress?: number
  earned?: number
  cap?: number
}>

export function dayKeysForGrowthWeek(weekKey: string) {
  return Array.from({ length: 7 }, (_, index) => shiftShanghaiDateKey(weekKey, index))
}

/**
 * The launch exception is a fixed historical compatibility rule. It is not a
 * recurring Monday rule and it never creates fake task-completion rows.
 */
export function getLaunchGraceDayForWeek(weekKey: string, now = new Date()) {
  if (weekKey !== TASK_SYSTEM_GRACE_WEEK_KEY) return null
  if (getShanghaiDateKey(now) < TASK_SYSTEM_GRACE_DATE_KEY) return null
  return TASK_SYSTEM_GRACE_DATE_KEY
}

function taskProgressTarget(task: Pick<GrowthTaskDefinition, 'dailyCap' | 'completionThreshold'>) {
  return task.dailyCap ?? task.completionThreshold ?? 1
}

function hasProgressTarget(task: Pick<GrowthTaskDefinition, 'dailyCap' | 'completionThreshold'>) {
  return task.dailyCap !== undefined || task.completionThreshold !== undefined
}

function getBusinessProgressOverride(
  taskCode: GrowthTaskCode,
  dateKey: string,
  businessFacts: GrowthBusinessCompletionFacts,
  actionProgressByCode?: ReadonlyMap<string, number>,
) {
  if (taskCode === 'DAILY_COMMENT') return businessFacts.commentRewardCountsByDate?.get(dateKey)
  if (taskCode === 'DAILY_GAME') return businessFacts.gameCompletionCountsByDate?.get(dateKey)
  return actionProgressByCode?.get(taskCode)
}

/** Resolve which registered daily tasks are complete for one date. */
function completedTaskCodesForDate(
  dateKey: string,
  rows: Iterable<GrowthCompletionDayRow>,
  businessFacts: GrowthBusinessCompletionFacts,
  tasks: readonly GrowthTaskDefinition[],
  actionProgressByCode: ReadonlyMap<string, number> = new Map(),
) {
  const rowsForDate = Array.from(rows).filter((row) => row.periodKey === dateKey)
  const completedCodes = new Set<GrowthTaskCode>()
  for (const task of tasks) {
    const rowCount = rowsForDate.filter((row) => row.taskCode === task.code).length
    const override = getBusinessProgressOverride(task.code, dateKey, businessFacts, actionProgressByCode)
    const current = Math.max(0, override ?? rowCount)

    if (task.code === 'DAILY_CHECKIN' && Array.from(businessFacts.checkinDateKeys || []).includes(dateKey)) {
      completedCodes.add(task.code)
      continue
    }
    if (task.code === 'DAILY_PRESCRIPTION' && Array.from(businessFacts.prescriptionDateKeys || []).includes(dateKey)) {
      completedCodes.add(task.code)
      continue
    }

    const completed = hasProgressTarget(task)
      ? current >= taskProgressTarget(task)
      : rowCount > 0
    if (completed) completedCodes.add(task.code)
  }
  return completedCodes
}

/**
 * Server-side source of truth for the today panel and the weekly day
 * calculation. All enabled daily tasks use this same registry-driven
 * completion rule; core/action is only a presentation breakdown.
 */
export function resolveTodayTaskProgress(input: {
  dateKey: string
  completionRows: Iterable<GrowthCompletionDayRow>
  businessFacts?: GrowthBusinessCompletionFacts
  actionProgress?: Iterable<GrowthActionProgressRow>
  taskDefinitions?: readonly GrowthTaskDefinition[]
}) {
  const completionRows = Array.from(input.completionRows)
  const businessFacts = input.businessFacts || {}
  const todayTasks = getTodayTasks(input.taskDefinitions)
  const coreTasks = getCoreActiveTasks(todayTasks)
  const bonusTasks = getActiveActionTasks(todayTasks)
  const actionProgressByCode = new Map<string, GrowthActionProgressRow>()
  for (const row of input.actionProgress || []) actionProgressByCode.set(row.taskCode, row)
  const actionProgressCounts = new Map<string, number>(
    Array.from(actionProgressByCode.entries()).map(([code, row]) => [code, row.progress]),
  )
  const completedCodes = completedTaskCodesForDate(input.dateKey, completionRows, businessFacts, todayTasks, actionProgressCounts)

  const tasks: GrowthTodayTaskStatus[] = todayTasks.map((task) => {
    const actionProgress = actionProgressByCode.get(task.code)
    const actionOverride = actionProgress ? new Map([[task.code, actionProgress.progress]]) : undefined
    const businessOverride = getBusinessProgressOverride(task.code, input.dateKey, businessFacts, actionOverride)
    const fallbackCount = completionRows.filter((row) => row.taskCode === task.code && row.periodKey === input.dateKey).length
    const current = Math.max(0, businessOverride ?? fallbackCount)
    const target = taskProgressTarget(task)
    const status: {
      code: GrowthTaskCode
      completed: boolean
      progress?: number
      earned?: number
      cap?: number
    } = {
      code: task.code,
      completed: hasProgressTarget(task) ? current >= target : completedCodes.has(task.code),
    }
    if (task.dailyCap !== undefined) {
      status.progress = Math.min(task.dailyCap, current)
      status.cap = task.dailyCap
    }
    if (actionProgress) {
      status.progress = Math.min(actionProgress.cap, Math.max(0, actionProgress.progress))
      status.earned = actionProgress.earned
      status.cap = actionProgress.cap
    }
    return status
  })
  const coreCompleted = tasks.filter((task) => coreTasks.some((coreTask) => coreTask.code === task.code) && task.completed).length
  const bonusCompleted = tasks.filter((task) => bonusTasks.some((bonusTask) => bonusTask.code === task.code) && task.completed).length
  const completed = tasks.filter((task) => task.completed).length
  return {
    total: tasks.length,
    completed,
    complete: tasks.length > 0 && completed === tasks.length,
    coreTotal: coreTasks.length,
    coreCompleted,
    bonusTotal: bonusTasks.length,
    bonusCompleted,
    tasks,
  }
}

/**
 * Returns days where every enabled task in the today panel reached its own
 * target. The returned set is derived, so repeated reads are naturally
 * idempotent and cannot add the same day twice.
 */
export function getCompletedDailyTaskDayKeys(
  weekKey: string,
  rows: Iterable<GrowthCompletionDayRow>,
  now = new Date(),
  businessFacts: GrowthBusinessCompletionFacts = {},
  taskDefinitions?: readonly GrowthTaskDefinition[],
) {
  const todayTasks = getTodayTasks(taskDefinitions)
  const weekDayKeys = dayKeysForGrowthWeek(weekKey)
  const completedDays = new Set<string>()
  const completionRows = Array.from(rows)
  for (const dateKey of weekDayKeys) {
    const counts = businessFacts.actionProgressCountsByDate?.get(dateKey) || new Map<string, number>()
    const completedCodes = completedTaskCodesForDate(dateKey, completionRows, businessFacts, todayTasks, counts)
    if (todayTasks.length > 0 && todayTasks.every((task) => completedCodes.has(task.code))) completedDays.add(dateKey)
  }

  const graceDay = getLaunchGraceDayForWeek(weekKey, now)
  if (graceDay) completedDays.add(graceDay)
  return completedDays
}

/** @deprecated Kept as a compatibility export; it now uses all today's tasks. */
export function getCompletedCoreDayKeys(
  weekKey: string,
  rows: Iterable<GrowthCompletionDayRow>,
  now = new Date(),
  businessFacts: GrowthBusinessCompletionFacts = {},
) {
  return getCompletedDailyTaskDayKeys(weekKey, rows, now, businessFacts)
}
