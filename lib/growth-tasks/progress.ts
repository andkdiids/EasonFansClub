import { getShanghaiDateKey, shiftShanghaiDateKey } from '@/lib/checkin'
import {
  TASK_SYSTEM_GRACE_DATE_KEY,
  TASK_SYSTEM_GRACE_WEEK_KEY,
  getActiveActionTasks,
  getCoreActiveTasks,
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
  return completedCodes
}

/**
 * Server-side source of truth for the six tasks shown in the today panel.
 * Core task rows may be supplemented by their actual business records, while
 * action-task completion remains based on its capped event progress.
 */
export function resolveTodayTaskProgress(input: {
  dateKey: string
  completionRows: Iterable<GrowthCompletionDayRow>
  businessFacts?: GrowthBusinessCompletionFacts
  actionProgress?: Iterable<GrowthActionProgressRow>
}) {
  const completedCoreCodes = completedCoreCodesForDate(input.dateKey, input.completionRows, input.businessFacts)
  const actionProgressByCode = new Map<string, GrowthActionProgressRow>()
  for (const row of input.actionProgress || []) actionProgressByCode.set(row.taskCode, row)

  const tasks: GrowthTodayTaskStatus[] = [
    ...getCoreActiveTasks().map((task) => ({ code: task.code, completed: completedCoreCodes.has(task.code) })),
    ...getActiveActionTasks().map((task) => {
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
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.completed).length,
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

  const completedDays = new Set(
    weekDayKeys.filter((dayKey) => coreCodes.length > 0 && coreCodes.every((code) => completedCodesByDay.get(dayKey)?.has(code))),
  )
  const graceDay = getLaunchGraceDayForWeek(weekKey, now)
  if (graceDay) completedDays.add(graceDay)
  return completedDays
}
