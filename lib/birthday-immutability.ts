import type { BirthdayParts } from '@/lib/zodiac'

export const BIRTHDAY_ALREADY_SET = 'BIRTHDAY_ALREADY_SET' as const
export const BIRTHDAY_ALREADY_SET_MESSAGE = '生日仅可设置一次，设置后不可修改。'

export type BirthdayState = {
  birthMonth: number | null | undefined
  birthDay: number | null | undefined
  birthdaySetAt: unknown
}

export type BirthdayRecord = {
  birthMonth: number | null
  birthDay: number | null
  birthdaySetAt: Date | null
}

export class BirthdayAlreadySetError extends Error {
  readonly code = BIRTHDAY_ALREADY_SET

  constructor() {
    super(BIRTHDAY_ALREADY_SET_MESSAGE)
    this.name = 'BirthdayAlreadySetError'
  }
}

/**
 * 生日由现有的月、日和首次设置时间字段共同表示。
 * 任一字段已有值都视为已经设置，避免历史或异常的部分数据重新获得修改机会。
 */
export function isBirthdayConfigured(value: BirthdayState | null | undefined): boolean {
  return Boolean(value && (value.birthMonth != null || value.birthDay != null || value.birthdaySetAt != null))
}

export function areBirthdayPartsEqual(
  value: BirthdayState | null | undefined,
  requested: BirthdayParts,
): boolean {
  return value?.birthMonth === requested.month && value.birthDay === requested.day
}

type BirthdayWriteClient = {
  user: {
    updateMany(args: {
      where: {
        id: string
        birthMonth: null
        birthDay: null
        birthdaySetAt: null
      }
      data: {
        birthMonth: number
        birthDay: number
        birthdaySetAt: Date
      }
    }): Promise<{ count: number }>
    findUnique(args: {
      where: { id: string }
      select: { birthMonth: true; birthDay: true; birthdaySetAt: true }
    }): Promise<BirthdayRecord | null>
  }
}

export type BirthdayWriteResult =
  | { status: 'set'; birthday: BirthdayParts }
  | { status: 'noop'; birthday: BirthdayParts | null }

/**
 * 原子地认领首次生日设置权：只有三个生日字段都为 NULL 的记录才能写入。
 * updateMany 的 count 是并发请求之间唯一的胜负依据；落败请求随后读取数据库，
 * 同值视为 no-op，异值（包括清空）统一拒绝。
 */
export async function writeBirthdayOnce(
  db: BirthdayWriteClient,
  userId: string,
  requested: BirthdayParts | null,
  birthdaySetAt = new Date(),
): Promise<BirthdayWriteResult> {
  if (requested) {
    const claimed = await db.user.updateMany({
      where: {
        id: userId,
        birthMonth: null,
        birthDay: null,
        birthdaySetAt: null,
      },
      data: {
        birthMonth: requested.month,
        birthDay: requested.day,
        birthdaySetAt,
      },
    })

    if (claimed.count === 1) return { status: 'set', birthday: requested }
  }

  const current = await db.user.findUnique({
    where: { id: userId },
    select: { birthMonth: true, birthDay: true, birthdaySetAt: true },
  })

  if (isBirthdayConfigured(current)) {
    if (requested && areBirthdayPartsEqual(current, requested)) {
      return { status: 'noop', birthday: requested }
    }
    throw new BirthdayAlreadySetError()
  }

  // requested === null is an empty payload from an as-yet-unconfigured form,
  // so it is harmless. A failed conditional write with no current record is
  // otherwise an unexpected account/race condition and must not be treated as success.
  if (!requested) return { status: 'noop', birthday: null }
  throw new Error('BIRTHDAY_FIRST_SET_FAILED')
}
