import { BEIJING_TIME_ZONE } from '@/lib/beijing-time'
import { getTodayMonthDay } from '@/lib/today'

export const ZODIAC_SIGNS = [
  'ARIES',
  'TAURUS',
  'GEMINI',
  'CANCER',
  'LEO',
  'VIRGO',
  'LIBRA',
  'SCORPIO',
  'SAGITTARIUS',
  'CAPRICORN',
  'AQUARIUS',
  'PISCES',
] as const

export type ZodiacSign = typeof ZODIAC_SIGNS[number]

export const ZODIAC_LABELS: Record<ZodiacSign, string> = {
  ARIES: '白羊座',
  TAURUS: '金牛座',
  GEMINI: '双子座',
  CANCER: '巨蟹座',
  LEO: '狮子座',
  VIRGO: '处女座',
  LIBRA: '天秤座',
  SCORPIO: '天蝎座',
  SAGITTARIUS: '射手座',
  CAPRICORN: '摩羯座',
  AQUARIUS: '水瓶座',
  PISCES: '双鱼座',
}

export type BirthdayParts = {
  month: number
  day: number
}

export type UserBirthdayParts = {
  birthMonth: number | null | undefined
  birthDay: number | null | undefined
}

type ZodiacRange = {
  start: BirthdayParts
  end: BirthdayParts
}

export const ZODIAC_DATE_RANGES: Record<ZodiacSign, ZodiacRange> = {
  ARIES: { start: { month: 3, day: 21 }, end: { month: 4, day: 19 } },
  TAURUS: { start: { month: 4, day: 20 }, end: { month: 5, day: 20 } },
  GEMINI: { start: { month: 5, day: 21 }, end: { month: 6, day: 21 } },
  CANCER: { start: { month: 6, day: 22 }, end: { month: 7, day: 22 } },
  LEO: { start: { month: 7, day: 23 }, end: { month: 8, day: 22 } },
  VIRGO: { start: { month: 8, day: 23 }, end: { month: 9, day: 22 } },
  LIBRA: { start: { month: 9, day: 23 }, end: { month: 10, day: 23 } },
  SCORPIO: { start: { month: 10, day: 24 }, end: { month: 11, day: 22 } },
  SAGITTARIUS: { start: { month: 11, day: 23 }, end: { month: 12, day: 21 } },
  CAPRICORN: { start: { month: 12, day: 22 }, end: { month: 1, day: 19 } },
  AQUARIUS: { start: { month: 1, day: 20 }, end: { month: 2, day: 18 } },
  PISCES: { start: { month: 2, day: 19 }, end: { month: 3, day: 20 } },
}

const ZODIAC_CODE_SET = new Set<string>(ZODIAC_SIGNS)

function ordinal({ month, day }: BirthdayParts) {
  return month * 100 + day
}

/** Validate the existing month/day birthday representation, including 2/29. */
export function isValidBirthdayParts(value: BirthdayParts | null | undefined): value is BirthdayParts {
  if (!value || !Number.isSafeInteger(value.month) || !Number.isSafeInteger(value.day)) return false
  if (value.month < 1 || value.month > 12 || value.day < 1 || value.day > 31) return false

  // A leap year is deliberately used only to validate the month/day pair. The
  // stored birthday has no year, so 2/29 is a valid birthday value.
  const probe = new Date(Date.UTC(2020, value.month - 1, value.day))
  return probe.getUTCMonth() === value.month - 1 && probe.getUTCDate() === value.day
}

export function isZodiacSign(value: unknown): value is ZodiacSign {
  return typeof value === 'string' && ZODIAC_CODE_SET.has(value)
}

/** Resolve a zodiac from month/day only; the birth year is intentionally ignored. */
export function getZodiacSignFromBirthday(value: BirthdayParts | null | undefined): ZodiacSign | null {
  if (!isValidBirthdayParts(value)) return null
  const current = ordinal(value)

  for (const sign of ZODIAC_SIGNS) {
    const range = ZODIAC_DATE_RANGES[sign]
    const start = ordinal(range.start)
    const end = ordinal(range.end)
    const matches = start <= end
      ? current >= start && current <= end
      : current >= start || current <= end
    if (matches) return sign
  }
  return null
}

export function getZodiacSignFromUserBirthday(value: UserBirthdayParts | null | undefined) {
  if (!value || value.birthMonth == null || value.birthDay == null) return null
  return getZodiacSignFromBirthday({ month: value.birthMonth, day: value.birthDay })
}

/** Resolve the current zodiac period from a calendar date in the requested timezone. */
export function getCurrentZodiacSign(now = new Date(), timezone = BEIJING_TIME_ZONE): ZodiacSign | null {
  const today = timezone === BEIJING_TIME_ZONE
    ? getTodayMonthDay(now)
    : (() => {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'numeric', day: 'numeric' }).formatToParts(now)
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
        return { month: Number(values.month), day: Number(values.day) }
      })()
  return getZodiacSignFromBirthday(today)
}

/** Stable yearly business key for the zodiac period currently in progress. */
export function getZodiacPeriodKey(now = new Date(), timezone = BEIJING_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const sign = getZodiacSignFromBirthday({ month: Number(values.month), day: Number(values.day) })
  if (!sign) return null
  const range = ZODIAC_DATE_RANGES[sign]
  const currentOrdinal = Number(values.month) * 100 + Number(values.day)
  const startOrdinal = range.start.month * 100 + range.start.day
  const endOrdinal = range.end.month * 100 + range.end.day
  const crossesYear = startOrdinal > endOrdinal
  const startYear = Number(values.year) - (crossesYear && currentOrdinal <= endOrdinal ? 1 : 0)
  return `${startYear}-${String(range.start.month).padStart(2, '0')}-${String(range.start.day).padStart(2, '0')}:${sign}`
}

export function isCurrentDateWithinZodiac(sign: ZodiacSign | string | null | undefined, now = new Date(), timezone = BEIJING_TIME_ZONE) {
  return isZodiacSign(sign) && getCurrentZodiacSign(now, timezone) === sign
}

/** Build a database filter for valid birthdays that fall in one zodiac range. */
export function getBirthdayWhereForZodiac(sign: ZodiacSign) {
  const range = ZODIAC_DATE_RANGES[sign]
  return {
    OR: [
      { birthMonth: range.start.month, birthDay: { gte: range.start.day } },
      { birthMonth: range.end.month, birthDay: { lte: range.end.day } },
    ],
  }
}

/** Compare a stored birthday with the current Shanghai calendar date. */
export function isBirthdayToday(value: BirthdayParts | null | undefined, now = new Date()) {
  if (!isValidBirthdayParts(value)) return false
  const today = getTodayMonthDay(now)
  return value.month === today.month && value.day === today.day
}

export function formatZodiacDateRange(sign: ZodiacSign) {
  const range = ZODIAC_DATE_RANGES[sign]
  return `${range.start.month}月${range.start.day}日 – ${range.end.month}月${range.end.day}日`
}

export function formatZodiacLabel(sign: ZodiacSign | null | undefined) {
  return sign && isZodiacSign(sign) ? ZODIAC_LABELS[sign] : '指定星座'
}
