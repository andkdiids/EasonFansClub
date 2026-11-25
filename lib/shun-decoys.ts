/**
 * Decoy (wrong suspect) selection for the capture step.
 *
 * The real actor is fixed by the take; only the decoys are chosen, and they are
 * chosen when the round is created so a later refresh can never reshuffle the
 * options. The goal is de-correlation: a decoy must not be recognisable as
 * "the wrong one" just because the real actor happens to be an active account
 * with a custom avatar.
 *
 * Pools, in priority order:
 *   1. the *victim's* accepted friends, preferring the same public look;
 *   2. recently active site-wide accounts with the same public look;
 *   3. other recently active accounts;
 *   4. the legacy random pool (any eligible account).
 *
 * The public look is deliberately only a *preference*: when no same-look
 * account exists the selection falls back instead of hard-filtering, otherwise
 * "custom avatar" itself would become a tell. Every pool is randomised, so no
 * fixed set of decoys can be learned over time.
 *
 * Pure module: no Prisma, no clock, no randomness of its own — the caller passes
 * the draw function, which keeps it simulatable in tests.
 */

export type DecoyCandidate = {
  id: string
  /** 0..4 activity tier from the shared `activityTier` mapping. */
  tier: number
  /** Whether the account shows a custom avatar instead of the default one. */
  hasAvatar: boolean
  /** Epoch ms of the last activity, used only to order pools. */
  lastActiveAt: number
}

export type DecoyPools = {
  friends: DecoyCandidate[]
  active: DecoyCandidate[]
  fallback: DecoyCandidate[]
}

export type DecoyActor = { id: string; hasAvatar: boolean; tier: number }

const LOOK_DISTANCE = 2

function closestTo(candidates: DecoyCandidate[], actor: DecoyActor) {
  // Same avatar state first, then the closest activity tier.
  return [...candidates].sort((left, right) => {
    const leftLook = Number(left.hasAvatar !== actor.hasAvatar)
    const rightLook = Number(right.hasAvatar !== actor.hasAvatar)
    if (leftLook !== rightLook) return leftLook - rightLook
    return Math.abs(left.tier - actor.tier) - Math.abs(right.tier - actor.tier)
  })
}

function takeRandom(pool: DecoyCandidate[], count: number, draw: (max: number) => number,
  chosen: Set<string>, excluded: Set<string>) {
  const available = pool.filter((candidate) => !chosen.has(candidate.id) && !excluded.has(candidate.id))
  let taken = 0
  while (taken < count && available.length) {
    const index = draw(available.length)
    const [picked] = available.splice(index, 1)
    chosen.add(picked.id)
    taken += 1
  }
}

/**
 * Picks `count` decoys (1 for the golden window, 2 after it).
 *
 * `excluded` carries the actor and the victim: neither may ever appear as a
 * suspect. The result is deduplicated and randomly ordered inside each tier.
 */
export function pickDecoys(pools: DecoyPools, actor: DecoyActor, count: number,
  draw: (max: number) => number, excluded: string[] = []): string[] {
  const banned = new Set([actor.id, ...excluded])
  const chosen = new Set<string>()

  // 1. The victim's friends, same-look first, then any other friend.
  const friends = closestTo(pools.friends, actor)
  takeRandom(friends.filter((candidate) => candidate.hasAvatar === actor.hasAvatar), count, draw, chosen, banned)
  takeRandom(friends, count - chosen.size, draw, chosen, banned)

  // 2. Recently active accounts, same-look first.
  const active = closestTo(pools.active, actor)
  takeRandom(active.filter((candidate) => Math.abs(candidate.tier - actor.tier) <= LOOK_DISTANCE || candidate.hasAvatar === actor.hasAvatar),
    count - chosen.size, draw, chosen, banned)

  // 3. Any other recently active account.
  takeRandom(active, count - chosen.size, draw, chosen, banned)

  // 4. Legacy pool: any eligible account, so a take never fails for a lack of
  //    decoys.
  takeRandom(pools.fallback, count - chosen.size, draw, chosen, banned)

  return [...chosen]
}
