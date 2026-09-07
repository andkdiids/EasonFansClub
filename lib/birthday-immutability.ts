import type { Prisma } from '@prisma/client'
import type { BirthdayParts } from '@/lib/zodiac'
import { isValidBirthdayParts } from '@/lib/zodiac'

export const BIRTHDAY_ALREADY_SET = 'BIRTHDAY_ALREADY_SET' as const
export const BIRTHDAY_ALREADY_SET_MESSAGE = '生日已设置，当前生日数据无法清空或覆盖。'
export const BIRTHDATE_SELF_EDIT_EXHAUSTED = 'BIRTHDATE_SELF_EDIT_EXHAUSTED' as const
export const BIRTHDATE_SELF_EDIT_EXHAUSTED_MESSAGE = '生日已修改过一次，无法再次自行修改生日。'
export const BIRTHDATE_SELF_EDIT_LIMIT = 1 as const

export type BirthdayState = {
  birthMonth: number | null | undefined
  birthDay: number | null | undefined
  birthdaySetAt: unknown
  birthdateSelfEditCount?: number | null | undefined
}

export type BirthdayRecord = {
  birthMonth: number | null
  birthDay: number | null
  birthdaySetAt: Date | null
  birthdateSelfEditCount?: number | null
}

export class BirthdayAlreadySetError extends Error {
  readonly code = BIRTHDAY_ALREADY_SET

  constructor(message = BIRTHDAY_ALREADY_SET_MESSAGE) {
    super(message)
    this.name = 'BirthdayAlreadySetError'
  }
}

export class BirthdaySelfEditExhaustedError extends Error {
  readonly code = BIRTHDATE_SELF_EDIT_EXHAUSTED

  constructor() {
    super(BIRTHDATE_SELF_EDIT_EXHAUSTED_MESSAGE)
    this.name = 'BirthdaySelfEditExhaustedError'
  }
}

/**
 * 生日由现有的月、日和首次设置时间字段共同表示。
 * 任一字段已有值都视为已经设置，避免历史或异常的部分数据重新获得首次设置机会。
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

function normalizedSelfEditCount(value: BirthdayState | null | undefined) {
  const count = Number(value?.birthdateSelfEditCount ?? 0)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/** Server-backed state used by both the profile API and the profile editor. */
export function getBirthdayEditState(value: BirthdayState | null | undefined) {
  const hasBirthdate = isBirthdayConfigured(value)
  const birthdateSelfEditCount = normalizedSelfEditCount(value)
  const birthdateEditUsed = birthdateSelfEditCount >= BIRTHDATE_SELF_EDIT_LIMIT
  return {
    hasBirthdate,
    birthdateSelfEditCount,
    birthdateEditUsed,
    canEditBirthdate: birthdateSelfEditCount < BIRTHDATE_SELF_EDIT_LIMIT,
    birthdayEditRemaining: hasBirthdate
      ? Math.max(0, BIRTHDATE_SELF_EDIT_LIMIT - birthdateSelfEditCount)
      : BIRTHDATE_SELF_EDIT_LIMIT,
  }
}

const birthdayMutationSelect = {
  birthMonth: true,
  birthDay: true,
  birthdaySetAt: true,
  birthdateSelfEditCount: true,
} satisfies Prisma.UserSelect

export type BirthdayMutationResult = {
  status: 'set' | 'updated' | 'noop'
  changed: boolean
  previousBirthday: BirthdayParts | null
  birthday: BirthdayParts | null
  birthdaySetAt: Date | null
  birthdateSelfEditCount: number
}

export type UpdateUserBirthdateOptions = {
  targetUserId: string
  birthdate: BirthdayParts | null
  actor: 'SELF' | 'ADMIN'
  now?: Date
}

/**
 * The single birthday mutation service used by self-service and admin flows.
 *
 * Self edits use conditional updateMany writes. The database row count is the
 * concurrency decision: two requests cannot both consume the one edit slot.
 * Admin edits deliberately omit birthdateSelfEditCount from every write.
 */
export async function updateUserBirthdate(
  tx: Prisma.TransactionClient,
  options: UpdateUserBirthdateOptions,
): Promise<BirthdayMutationResult> {
  const now = options.now || new Date()
  const current = await tx.user.findUnique({
    where: { id: options.targetUserId },
    select: birthdayMutationSelect,
  })
  if (!current) throw new Error('USER_NOT_FOUND')

  if (options.birthdate && !isValidBirthdayParts(options.birthdate)) {
    throw new Error('INVALID_BIRTHDAY')
  }

  const currentConfigured = isBirthdayConfigured(current)
  const currentBirthday = current.birthMonth != null && current.birthDay != null
    ? { month: current.birthMonth, day: current.birthDay }
    : null
  const currentCount = normalizedSelfEditCount(current)

  if (options.birthdate && currentBirthday && areBirthdayPartsEqual(current, options.birthdate)) {
    return {
      status: 'noop',
      changed: false,
      previousBirthday: currentBirthday,
      birthday: currentBirthday,
      birthdaySetAt: current.birthdaySetAt,
      birthdateSelfEditCount: currentCount,
    }
  }

  if (!options.birthdate) {
    // Empty input is harmless for an account that has never had a birthday.
    // Once any birthday field exists, an accidental clear must not create a
    // second interpretation of the self-edit policy.
    if (!currentConfigured) {
      return {
        status: 'noop',
        changed: false,
        previousBirthday: null,
        birthday: null,
        birthdaySetAt: current.birthdaySetAt,
        birthdateSelfEditCount: currentCount,
      }
    }
    throw new BirthdayAlreadySetError()
  }

  if (options.actor === 'SELF') {
    if (currentConfigured && (currentBirthday === null || currentCount >= BIRTHDATE_SELF_EDIT_LIMIT)) {
      if (currentCount >= BIRTHDATE_SELF_EDIT_LIMIT) throw new BirthdaySelfEditExhaustedError()
      throw new BirthdayAlreadySetError()
    }

    const where = currentConfigured
      ? {
          id: options.targetUserId,
          birthMonth: current.birthMonth,
          birthDay: current.birthDay,
          birthdaySetAt: current.birthdaySetAt,
          birthdateSelfEditCount: { lt: BIRTHDATE_SELF_EDIT_LIMIT },
        }
      : {
          id: options.targetUserId,
          birthMonth: null,
          birthDay: null,
          birthdaySetAt: null,
          birthdateSelfEditCount: { lt: BIRTHDATE_SELF_EDIT_LIMIT },
        }
    const data = currentConfigured
      ? {
          birthMonth: options.birthdate.month,
          birthDay: options.birthdate.day,
          birthdateSelfEditCount: { increment: 1 },
        }
      : {
          birthMonth: options.birthdate.month,
          birthDay: options.birthdate.day,
          birthdaySetAt: now,
        }

    const updated = await tx.user.updateMany({ where, data })
    if (updated.count === 1) {
      return {
        status: currentConfigured ? 'updated' : 'set',
        changed: true,
        previousBirthday: currentBirthday,
        birthday: options.birthdate,
        birthdaySetAt: currentConfigured ? current.birthdaySetAt : now,
        birthdateSelfEditCount: currentConfigured ? currentCount + 1 : currentCount,
      }
    }

    // A concurrent request may have won the conditional update. A same-date
    // retry is still a no-op; a different date reports the correct lock state.
    const latest = await tx.user.findUnique({
      where: { id: options.targetUserId },
      select: birthdayMutationSelect,
    })
    if (!latest) throw new Error('USER_NOT_FOUND')
    if (areBirthdayPartsEqual(latest, options.birthdate)) {
      return {
        status: 'noop',
        changed: false,
        previousBirthday: latest.birthMonth != null && latest.birthDay != null
          ? { month: latest.birthMonth, day: latest.birthDay }
          : null,
        birthday: options.birthdate,
        birthdaySetAt: latest.birthdaySetAt,
        birthdateSelfEditCount: normalizedSelfEditCount(latest),
      }
    }
    if (normalizedSelfEditCount(latest) >= BIRTHDATE_SELF_EDIT_LIMIT) throw new BirthdaySelfEditExhaustedError()
    throw new BirthdayAlreadySetError()
  }

  // Admin changes are allowed regardless of the self-edit counter. Setting a
  // previously empty birthday establishes its timestamp; changing an existing
  // birthday preserves the original timestamp and counter.
  const updated = await tx.user.update({
    where: { id: options.targetUserId },
    data: {
      birthMonth: options.birthdate.month,
      birthDay: options.birthdate.day,
      ...(current.birthdaySetAt ? {} : { birthdaySetAt: now }),
    },
    select: birthdayMutationSelect,
  })
  return {
    status: currentConfigured ? 'updated' : 'set',
    changed: true,
    previousBirthday: currentBirthday,
    birthday: options.birthdate,
    birthdaySetAt: updated.birthdaySetAt,
    birthdateSelfEditCount: normalizedSelfEditCount(updated),
  }
}
