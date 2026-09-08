import { getShanghaiDateKey, shiftShanghaiDateKey } from '@/lib/checkin'
import {
  TASK_SYSTEM_GRACE_DATE_KEY,
  TASK_SYSTEM_GRACE_WEEK_KEY,
  getActiveActionTasks,
  getCoreActiveTasks,
  getGrowthTask,
  type GrowthTaskCode,
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

function addBusinessFact(completedCodesByDay: Map<string, Set<string>>, dayKey: string, taskCode: GrowthTaskCode, dayKeySet: ReadonlySet<string>) {
  if (!dayKeySet.has(dayKey)) return
  const codes = completedCodesByDay.get(dayKey) || new Set<string>()
  codes.add(taskCode)
  completedCodesByDay.set(dayKey, codes)
}

function completedCoreCodesForDate(
  dateKey: string,
  rows: Iterable<GrowthCompletionDayRow>,
  businessFacts: GrowthBusinessCompletionFacts = {},
) {
  const coreCodeSet = new Set<string>(getCoreActiveTasks().map((task) => task.code))
  const completedCodes = new Set<string>()
  for (const row of rows) {
    if (row.periodKey === dateKey && coreCodeSet.has(row.taskCode)) completedCodes.add(row.taskCode)
  }
  if (Array.from(businessFacts.checkinDateKeys || []).includes(dateKey)) completedCodes.add('DAILY_CHECKIN')
  if (Array.from(businessFacts.prescriptionDateKeys || []).includes(dateKey)) completedCodes.add('DAILY_PRESCRIPTION')
  const commentCount = businessFacts.commentRewardCountsByDate?.get(dateKey)
  if (commentCount !== undefined) {
    if (commentCount >= (getGrowthTask('DAILY_COMMENT')?.completionThreshold || 1)) completedCodes.add('DAILY_COMMENT')
    else completedCodes.delete('DAILY_COMMENT')
  }
  const gameCount = businessFacts.gameCompletionCountsByDate?.get(dateKey)
  if (gameCount !== undefined) {
    if (gameCount >= (getGrowthTask('DAILY_GAME')?.completionThreshold || 1)) completedCodes.add('DAILY_GAME')
    else completedCodes.delete('DAILY_GAME')
  }
  return completedCodes
}

/**
 * Server-side source of truth for the today panel. The list contains core
 * tasks and bonus action tasks, but only core tasks determine whether a day
 * is complete for the weekly milestones.
 */
export function resolveTodayTaskProgress(input: {
  dateKey: string
  completionRows: Iterable<GrowthCompletionDayRow>
  businessFacts?: GrowthBusinessCompletionFacts
  actionProgress?: Iterable<GrowthActionProgressRow>
}) {
  const completionRows = Array.from(input.completionRows)
  const coreTasks = getCoreActiveTasks()
  const bonusTasks = getActiveActionTasks()
  const completedCoreCodes = completedCoreCodesForDate(input.dateKey, completionRows, input.businessFacts)
  const actionProgressByCode = new Map<string, GrowthActionProgressRow>()
  for (const row of input.actionProgress || []) actionProgressByCode.set(row.taskCode, row)

  const coreStatuses: GrowthTodayTaskStatus[] = coreTasks.map((task) => {
    const isComment = task.code === 'DAILY_COMMENT'
    const isGame = task.code === 'DAILY_GAME'
    const businessCount = isComment
      ? input.businessFacts?.commentRewardCountsByDate?.get(input.dateKey)
      : isGame
        ? input.businessFacts?.gameCompletionCountsByDate?.get(input.dateKey)
        : undefined
    const fallbackCount = completionRows.filter((row) => row.taskCode === task.code && row.periodKey === input.dateKey).length
    const rawProgress = businessCount ?? fallbackCount
    const cap = task.dailyCap
    const progress = cap === undefined ? undefined : Math.min(cap, Math.max(0, rawProgress))
    const threshold = task.completionThreshold || (cap === undefined ? 1 : cap)
    return {
      code: task.code,
      completed: isComment || isGame ? rawProgress >= threshold : completedCoreCodes.has(task.code),
      ...(cap === undefined ? {} : { progress: progress || 0, cap }),
    }
  })
  const tasks: GrowthTodayTaskStatus[] = [
    ...coreStatuses,
    ...bonusTasks.map((task) => {
      const progress = actionProgressByCode.get(task.code)
      const cap = progress?.cap ?? task.dailyCap ?? 0
      return {
        code: task.code,
        completed: cap > 0 && (progress?.progress || 0) >= cap,
        progress: progress?.progress || 0,
        earned: progress?.earned || 0,
        cap,
      }
    }),
  ]
  const coreCompleted = tasks.filter((task) => coreTasks.some((coreTask) => coreTask.code === task.code) && task.completed).length
  const bonusCompleted = tasks.filter((task) => bonusTasks.some((bonusTask) => bonusTask.code === task.code) && task.completed).length
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.completed).length,
    coreTotal: coreTasks.length,
    coreCompleted,
    bonusTotal: bonusTasks.length,
    bonusCompleted,
    tasks,
  }
}

export function getCompletedCoreDayKeys(
  weekKey: string,
  rows: Iterable<GrowthCompletionDayRow>,
  now = new Date(),
  businessFacts: GrowthBusinessCompletionFacts = {},
) {
  const coreCodes = getCoreActiveTasks().map((task) => task.code)
  const coreCodeSet = new Set<string>(coreCodes)
  const weekDayKeys = dayKeysForGrowthWeek(weekKey)
  const weekDayKeySet = new Set(weekDayKeys)
  const completedCodesByDay = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!coreCodeSet.has(row.taskCode)) continue
    if (!weekDayKeySet.has(row.periodKey)) continue
    completedCodesByDay.set(row.periodKey, (completedCodesByDay.get(row.periodKey) || new Set()).add(row.taskCode))
  }

  for (const dateKey of businessFacts.checkinDateKeys || []) addBusinessFact(completedCodesByDay, dateKey, 'DAILY_CHECKIN', weekDayKeySet)
  for (const dateKey of businessFacts.prescriptionDateKeys || []) addBusinessFact(completedCodesByDay, dateKey, 'DAILY_PRESCRIPTION', weekDayKeySet)

  const applyCountFact = (counts: ReadonlyMap<string, number> | undefined, taskCode: GrowthTaskCode) => {
    if (!counts) return
    const task = getGrowthTask(taskCode)
    const threshold = task?.completionThreshold || 1
    for (const [dateKey, count] of counts) {
      if (!weekDayKeySet.has(dateKey)) continue
      const codes = completedCodesByDay.get(dateKey) || new Set<string>()
      if (count >= threshold) codes.add(taskCode)
      else codes.delete(taskCode)
      if (codes.size > 0) completedCodesByDay.set(dateKey, codes)
      else completedCodesByDay.delete(dateKey)
    }
  }
  applyCountFact(businessFacts.commentRewardCountsByDate, 'DAILY_COMMENT')
  applyCountFact(businessFacts.gameCompletionCountsByDate, 'DAILY_GAME')

  const completedDays = new Set(
    weekDayKeys.filter((dayKey) => coreCodes.length > 0 && coreCodes.every((code) => completedCodesByDay.get(dayKey)?.has(code))),
  )
  const graceDay = getLaunchGraceDayForWeek(weekKey, now)
  if (graceDay) completedDays.add(graceDay)
  return completedDays
}
