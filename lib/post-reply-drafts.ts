export type PostReplyDraftTargetType = 'POST' | 'COMMENT'

export type PostReplyDraftTarget = {
  targetType: PostReplyDraftTargetType
  targetId: string
}

export type PostReplyDrafts = Record<string, string>

export function getPostReplyDraftKey(postId: string, target: PostReplyDraftTarget) {
  return `post-reply-draft:${postId}:${target.targetType}:${target.targetId}`
}

function getDraftKeyPrefix(postId: string) {
  return `post-reply-draft:${postId}:`
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function readPostReplyDrafts(postId: string, storage: Storage | null = getSessionStorage()): PostReplyDrafts {
  const drafts: PostReplyDrafts = {}
  if (!storage) return drafts

  try {
    const prefix = getDraftKeyPrefix(postId)
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key?.startsWith(prefix)) continue
      const value = storage.getItem(key)
      if (value?.trim()) drafts[key] = value
    }
  } catch {
    return {}
  }
  return drafts
}

export function writePostReplyDraft(key: string, content: string, storage: Storage | null = getSessionStorage()) {
  if (!storage) return
  try {
    if (content.trim()) storage.setItem(key, content)
    else storage.removeItem(key)
  } catch {
    // sessionStorage is only a best-effort fallback; React state remains the source
    // of truth while the current post page is mounted.
  }
}

export function clearPostReplyDrafts(postId: string, storage: Storage | null = getSessionStorage()) {
  if (!storage) return
  try {
    const prefix = getDraftKeyPrefix(postId)
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch {
    // A private browsing session may reject storage access; there is no server draft to clean up.
  }
}
