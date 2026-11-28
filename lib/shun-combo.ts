/**
 * V4.2.4 — the single source of truth for active-take attack item combinations.
 *
 * The eight legal modes are expressed by one ordered set of codes. There is
 * deliberately no per-combination business branch anywhere else: the settlement
 * reads the resolved effect once, so accounting, quotas, decoys and idempotency
 * behave identically for every subset.
 */

export const SHUN_ATTACK_CODES = ['TARGET_FRIEND', 'DOUBLE_AMOUNT', 'EXTRA_SUSPECT'] as const

export type ShunAttackCode = (typeof SHUN_ATTACK_CODES)[number]

export type ShunCombo = {
  codes: ShunAttackCode[]
  targetFriend: boolean
  doubleAmount: boolean
  extraSuspect: boolean
  multiplier: 1 | 2
  /** Candidates shown to the chooser: the actor plus this many decoys. */
  decoyCount: 2 | 3
  /** Total suspects: golden 2 -> 3, normal 3 -> 4 when 十面埋伏 is active. */
  candidateCount: 3 | 4
}

const CODE_SET = new Set<string>(SHUN_ATTACK_CODES)

/** Returns null for any invalid, duplicated or unknown combination. */
export function normalizeAttackCodes(input: unknown): ShunAttackCode[] | null {
  if (!Array.isArray(input)) return null
  const seen = new Set<string>()
  for (const code of input) {
    if (typeof code !== 'string' || !CODE_SET.has(code) || seen.has(code)) return null
    seen.add(code)
  }
  // Store in a stable order so two clients sending the same selection in a
  // different order still share one idempotency fingerprint.
  return SHUN_ATTACK_CODES.filter((code) => seen.has(code))
}

export function resolveShunCombo(codes: readonly ShunAttackCode[]): ShunCombo {
  const set = new Set(codes)
  const extraSuspect = set.has('EXTRA_SUSPECT')
  return {
    codes: SHUN_ATTACK_CODES.filter((code) => set.has(code)),
    targetFriend: set.has('TARGET_FRIEND'),
    doubleAmount: set.has('DOUBLE_AMOUNT'),
    extraSuspect,
    multiplier: set.has('DOUBLE_AMOUNT') ? 2 : 1,
    decoyCount: extraSuspect ? 3 : 2,
    candidateCount: extraSuspect ? 4 : 3,
  }
}

export const EMPTY_COMBO = resolveShunCombo([])

/** Stable fingerprint persisted on a round through its item-effect rows. */
export function comboFingerprint(codes: readonly ShunAttackCode[]) {
  return SHUN_ATTACK_CODES.map((code) => (codes.includes(code) ? '1' : '0')).join('')
}

/** Human-readable effect lines used by the selection preview and result card. */
export function comboEffectLines(codes: readonly ShunAttackCode[]): string[] {
  const combo = resolveShunCombo(codes)
  const lines: string[] = []
  if (combo.targetFriend) lines.push('指定一位通讯录好友。')
  if (combo.doubleAmount) lines.push('顺取金额翻倍，最多14挂号费。')
  if (combo.extraSuspect) lines.push('对方黄金抓捕期三选一，普通抓捕期四选一。')
  return lines
}
