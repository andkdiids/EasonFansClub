import { getShanghaiDateKey, shiftShanghaiDateKey } from '@/lib/checkin'
import {
  TASK_SYSTEM_GRACE_DATE_KEY,
  TASK_SYSTEM_GRACE_WEEK_KEY,
  getCoreActiveTasks,
} from './registry'

export type GrowthCompletionDayRow = Readonly<{
  taskCode: string
  periodKey: string
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

export function getCompletedCoreDayKeys(
  weekKey: string,
  rows: Iterable<GrowthCompletionDayRow>,
  now = new Date(),
) {
  const coreCodes = getCoreActiveTasks().map((task) => task.code)
  const coreCodeSet = new Set<string>(coreCodes)
  const completedCodesByDay = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!coreCodeSet.has(row.taskCode)) continue
    if (!dayKeysForGrowthWeek(weekKey).includes(row.periodKey)) continue
    completedCodesByDay.set(row.periodKey, (completedCodesByDay.get(row.periodKey) || new Set()).add(row.taskCode))
  }

  const completedDays = new Set(
    dayKeysForGrowthWeek(weekKey).filter((dayKey) => coreCodes.length > 0 && coreCodes.every((code) => completedCodesByDay.get(dayKey)?.has(code))),
  )
  const graceDay = getLaunchGraceDayForWeek(weekKey, now)
  if (graceDay) completedDays.add(graceDay)
  return completedDays
}
