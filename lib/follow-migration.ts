export type LegacyFriendshipRow = Readonly<{
  userAId: string
  userBId: string
}>

export type FollowEdge = Readonly<{
  followerId: string
  followingId: string
}>

export type LegacyUserState = Readonly<{
  id: string
  status: string
  isDeleted: boolean
  hasProfile: boolean
}>

export type LegacyBlockRow = Readonly<{
  blockerId: string
  blockedId: string
}>

export type FollowBackfillPlan = Readonly<{
  oldFriendCount: number
  validPairs: number
  expectedFollowRows: number
  existingFollowRows: number
  alreadyExisting: number
  wouldInsertForward: number
  wouldInsertReverse: number
  blockedPairs: number
  invalidPairs: number
  selfRelations: number
  reversedDuplicatePairs: number
  backfillEdges: ReadonlyArray<FollowEdge>
  validPairKeys: ReadonlySet<string>
}>

export function normalizeLegacyFriendshipPair(userAId: string, userBId: string): [string, string] | null {
  const left = userAId.trim()
  const right = userBId.trim()
  if (!left || !right || left === right) return null
  return [left, right].sort() as [string, string]
}

export function undirectedPairKey(left: string, right: string) {
  const pair = normalizeLegacyFriendshipPair(left, right)
  return pair ? `${pair[0]}:${pair[1]}` : `${left}:${right}`
}

export function directionalFollowKey(followerId: string, followingId: string) {
  return `${followerId}:${followingId}`
}

export function buildFollowBackfillPlan(input: {
  friendships: ReadonlyArray<LegacyFriendshipRow>
  follows: ReadonlyArray<FollowEdge>
  blocks: ReadonlyArray<LegacyBlockRow>
  users: ReadonlyArray<LegacyUserState>
}): FollowBackfillPlan {
  const availableUsers = new Set(
    input.users
      .filter((user) => user.status === 'ACTIVE' && !user.isDeleted && user.hasProfile)
      .map((user) => user.id),
  )
  const existingFollowKeys = new Set(input.follows.map((row) => directionalFollowKey(row.followerId, row.followingId)))
  const blockedPairKeys = new Set(input.blocks.map((row) => undirectedPairKey(row.blockerId, row.blockedId)))
  const pairCounts = new Map<string, number>()
  const normalizedPairs = new Map<string, [string, string]>()
  let selfRelations = 0

  for (const friendship of input.friendships) {
    if (friendship.userAId.trim() === friendship.userBId.trim()) {
      selfRelations += 1
      continue
    }
    const pair = normalizeLegacyFriendshipPair(friendship.userAId, friendship.userBId)
    if (!pair) continue
    const key = `${pair[0]}:${pair[1]}`
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1)
    normalizedPairs.set(key, pair)
  }

  const reversedDuplicatePairs = [...pairCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0)
  const validPairKeys = new Set<string>()
  let invalidPairs = 0
  let blockedPairs = 0
  const backfillEdges: FollowEdge[] = []
  let existingFollowRows = 0
  let wouldInsertForward = 0
  let wouldInsertReverse = 0

  for (const [key, pair] of normalizedPairs) {
    if (!availableUsers.has(pair[0]) || !availableUsers.has(pair[1])) {
      invalidPairs += 1
      continue
    }
    validPairKeys.add(key)
    if (blockedPairKeys.has(key)) blockedPairs += 1

    const forward = { followerId: pair[0], followingId: pair[1] } as const
    const reverse = { followerId: pair[1], followingId: pair[0] } as const
    for (const edge of [forward, reverse]) {
      if (existingFollowKeys.has(directionalFollowKey(edge.followerId, edge.followingId))) existingFollowRows += 1
      else {
        backfillEdges.push(edge)
        if (edge === forward) wouldInsertForward += 1
        else wouldInsertReverse += 1
      }
    }
  }

  return {
    oldFriendCount: input.friendships.length,
    validPairs: validPairKeys.size,
    expectedFollowRows: validPairKeys.size * 2,
    existingFollowRows,
    alreadyExisting: existingFollowRows,
    wouldInsertForward,
    wouldInsertReverse,
    blockedPairs,
    invalidPairs,
    selfRelations,
    reversedDuplicatePairs,
    backfillEdges,
    validPairKeys,
  }
}
