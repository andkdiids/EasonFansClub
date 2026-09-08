export const NICKNAME_COOLDOWN_HOURS = 24

export type NicknameChangeAvailability = {
  lastChangedAt: Date | null
  nextAllowedAt: Date | null
  canChange: boolean
  cooldownDays: number
  opportunityAvailable: boolean
  cooldownActive: boolean
}

export type NicknameChangeView = {
  lastChangedAt: string | null
  nextAllowedAt: string | null
  canChange: boolean
  cooldownDays: number
  opportunityAvailable: boolean
  cooldownActive: boolean
}

/**
 * The one-time opportunity is independent from the historical nickname
 * timestamp. A user may spend it even when the old cooldown is still active;
 * only a successful nickname mutation consumes it.
 */
export function getNicknameChangeAvailability({
  lastChangedAt,
  freeChangeUsedAt,
  cooldownDays,
  now = new Date(),
}: {
  lastChangedAt: Date | null | undefined
  freeChangeUsedAt: Date | null | undefined
  cooldownDays: number
  now?: Date
}): NicknameChangeAvailability {
  const normalizedLastChangedAt = lastChangedAt ?? null
  const opportunityAvailable = !freeChangeUsedAt
  const cooldownEndsAt = normalizedLastChangedAt
    ? new Date(normalizedLastChangedAt.getTime() + cooldownDays * NICKNAME_COOLDOWN_HOURS * 60 * 60 * 1000)
    : null
  const cooldownActive = Boolean(cooldownEndsAt && now.getTime() < cooldownEndsAt.getTime())

  return {
    lastChangedAt: normalizedLastChangedAt,
    nextAllowedAt: opportunityAvailable || !cooldownActive ? null : cooldownEndsAt,
    canChange: opportunityAvailable || !cooldownActive,
    cooldownDays,
    opportunityAvailable,
    cooldownActive: !opportunityAvailable && cooldownActive,
  }
}

export function serializeNicknameChange(
  lastChangedAt: Date | null | undefined,
  freeChangeUsedAt: Date | null | undefined,
  cooldownDays: number,
  now = new Date(),
): NicknameChangeView {
  const availability = getNicknameChangeAvailability({
    lastChangedAt,
    freeChangeUsedAt,
    cooldownDays,
    now,
  })

  return {
    lastChangedAt: availability.lastChangedAt?.toISOString() ?? null,
    nextAllowedAt: availability.nextAllowedAt?.toISOString() ?? null,
    canChange: availability.canChange,
    cooldownDays: availability.cooldownDays,
    opportunityAvailable: availability.opportunityAvailable,
    cooldownActive: availability.cooldownActive,
  }
}
