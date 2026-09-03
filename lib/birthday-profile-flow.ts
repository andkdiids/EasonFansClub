import { isBirthdayConfigured, type BirthdayState } from '@/lib/birthday-immutability'
import { isValidBirthdayParts, type BirthdayParts } from '@/lib/zodiac'

export type BirthdayDraft = {
  month: number | null
  day: number | null
}

export type BirthdaySaveDecision =
  | { kind: 'none' }
  | { kind: 'incomplete'; message: '请选择完整的生日日期' | '该日期不存在，请重新选择' }
  | { kind: 'confirm'; birthday: BirthdayParts }
  | { kind: 'locked' }

/**
 * Decide what saving the birthday draft is allowed to do without ever treating
 * a draft selection as a persisted birthday.
 */
export function decideBirthdaySave(
  persistedBirthday: BirthdayState | null | undefined,
  draft: BirthdayDraft,
): BirthdaySaveDecision {
  if (isBirthdayConfigured(persistedBirthday)) return { kind: 'locked' }

  const { month, day } = draft
  if (month == null && day == null) return { kind: 'none' }
  if (month == null || day == null) return { kind: 'incomplete', message: '请选择完整的生日日期' }

  const birthday = { month, day }
  if (!isValidBirthdayParts(birthday)) return { kind: 'incomplete', message: '该日期不存在，请重新选择' }
  return { kind: 'confirm', birthday }
}

export function daysForBirthdayMonth(month: number | null): number {
  if (!month || month < 1 || month > 12) return 31
  // 二月返回 29，允许闰年 2 月 29 日生日；由服务端最终校验日期合法性。
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

/** Clear a draft day only when the newly selected month makes it impossible. */
export function resetInvalidBirthdayDay(month: number | null, day: number | null): number | null {
  if (month == null || day == null) return day
  return day > daysForBirthdayMonth(month) ? null : day
}
