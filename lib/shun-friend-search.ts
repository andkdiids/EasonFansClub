/** Pure matching rule shared by the 任我顺 friend picker and its tests. */
export type TargetFriendView = {
  id: string
  uid: number
  nickname: string
  displayName: string
  remark: string | null
}

/**
 * Matches nickname, uid, internal friend id and the viewer's own remark.
 * The caller must restrict the input list to eligible directory friends, so
 * search can never surface a non-friend or bypass quota filtering.
 */
export function matchesTargetFriend(friend: TargetFriendView, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return true
  if ([friend.nickname, friend.displayName, friend.remark, friend.id, String(friend.uid)]
    .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(query))) return true
  // Numeric search also accepts leading zeros ("007" finds uid 7).
  const digits = query.replace(/^0+(?=\d)/, '')
  if (!/^\d+$/.test(digits)) return false
  const uid = Number(digits)
  return Number.isSafeInteger(uid) && friend.uid === uid
}
