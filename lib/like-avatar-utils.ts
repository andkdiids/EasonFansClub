export function mergeLikeAvatarUsers<T extends { id: string }>(current: T[], incoming: T[]) {
  const result = [...current]
  const indexes = new Map(result.map((liker, index) => [liker.id, index]))
  for (const liker of incoming) {
    const index = indexes.get(liker.id)
    if (index === undefined) {
      indexes.set(liker.id, result.length)
      result.push(liker)
    } else {
      result[index] = { ...result[index], ...liker }
    }
  }
  return result
}

export function getLikeAvatarPreview<T>(likers: T[], totalCount: number, limit: number) {
  const visible = likers.slice(0, Math.max(0, Math.floor(limit)))
  return {
    visible,
    overflow: Math.max(Math.max(0, totalCount) - visible.length, 0),
  }
}
