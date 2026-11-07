import { parseContentImageUrls } from '@/lib/content-images'
import { storedImageUrl } from '@/lib/images'
import { validateRichPostContent, type RichTextContent } from '@/lib/rich-text'
import { normalizeTopicKey, normalizeTopicName } from '@/lib/post-topics'
import { parsePostExpiryType, type PostExpiryType } from '@/lib/post-lifecycle'

export const POST_DRAFT_STORAGE_KEY = 'eason-forum-post-draft:v2'
export const POST_DRAFT_AUTOSAVE_DEBOUNCE_MS = 1000
export const POST_DRAFT_LOCAL_CACHE_DEBOUNCE_MS = 250
export const POST_DRAFT_MAX_TITLE_LENGTH = 120
export const POST_DRAFT_MAX_CONTENT_LENGTH = 20_000
export const POST_DRAFT_MAX_STICKER_NAME_LENGTH = 120
export const POST_DRAFT_MAX_STICKER_URL_LENGTH = 2_000

export type PostDraftSticker = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
}

export type PostDraftPayload = {
  boardId: string
  title: string
  content: string
  richContent: RichTextContent | null
  imageUrls: string[]
  pendingSticker: PostDraftSticker | null
  topicNames: string[]
  expiryType: PostExpiryType | null
}

export type StoredPostDraft = PostDraftPayload & {
  localUpdatedAt: string
  serverVersion: number | null
}

export type ServerPostDraft = PostDraftPayload & {
  id: string
  version: number
  updatedAt: string
}

export function postDraftStorageKey(userId: string) {
  return `${POST_DRAFT_STORAGE_KEY}:${userId}`
}

export function postDraftConflictStorageKey(userId: string) {
  return `${postDraftStorageKey(userId)}:conflict`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSticker(value: unknown): PostDraftSticker | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim().slice(0, 191) : ''
  const url = typeof value.url === 'string' ? storedImageUrl(value.url)?.slice(0, POST_DRAFT_MAX_STICKER_URL_LENGTH) || '' : ''
  const type = value.type === 'STATIC' || value.type === 'GIF' ? value.type : null
  if (!id || !url || !type) return null
  const name = typeof value.name === 'string'
    ? value.name.slice(0, POST_DRAFT_MAX_STICKER_NAME_LENGTH)
    : null
  return { id, name, url, type }
}

function normalizeTopicNames(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of value) {
    const name = normalizeTopicName(item)
    if (!name) continue
    const key = normalizeTopicKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length >= 5) break
  }
  return names
}

/**
 * Normalize both legacy local records and server payloads into the exact
 * state shape used by the create editor. Rich JSON remains authoritative for
 * formatted content; plain text is retained for old local drafts.
 */
export function parsePostDraftPayload(
  value: unknown,
  validBoardIds?: readonly string[],
): PostDraftPayload | null {
  if (!isRecord(value)) return null

  const rawBoardId = typeof value.boardId === 'string' ? value.boardId.trim().slice(0, 80) : ''
  const boardId = validBoardIds && rawBoardId && !validBoardIds.includes(rawBoardId) ? '' : rawBoardId
  const title = typeof value.title === 'string' ? value.title.slice(0, POST_DRAFT_MAX_TITLE_LENGTH) : ''
  let content = typeof value.content === 'string' ? value.content.slice(0, POST_DRAFT_MAX_CONTENT_LENGTH) : ''
  let richContent: RichTextContent | null = null

  if (value.richContent !== null && value.richContent !== undefined) {
    const richResult = validateRichPostContent(value.richContent)
    if (richResult.valid) {
      richContent = richResult.value
      content = richResult.plainText
    }
  }

  const rawImageUrls = value.imageUrls
  const imageUrls = Array.isArray(rawImageUrls)
    ? parseContentImageUrls(rawImageUrls)
    : []

  return {
    boardId,
    title,
    content,
    richContent,
    imageUrls,
    pendingSticker: normalizeSticker(value.pendingSticker),
    topicNames: normalizeTopicNames(value.topicNames),
    expiryType: parsePostExpiryType(value.expiryType),
  }
}

export function parseStoredPostDraft(
  raw: string | null,
  validBoardIds?: readonly string[],
): StoredPostDraft | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    const payload = parsePostDraftPayload(parsed, validBoardIds)
    if (!payload || !isRecord(parsed)) return null
    const localUpdatedAt = typeof parsed.localUpdatedAt === 'string' && !Number.isNaN(Date.parse(parsed.localUpdatedAt))
      ? parsed.localUpdatedAt
      : new Date(0).toISOString()
    const serverVersion = Number.isInteger(parsed.serverVersion) && Number(parsed.serverVersion) > 0
      ? Number(parsed.serverVersion)
      : null
    return { ...payload, localUpdatedAt, serverVersion }
  } catch {
    return null
  }
}

export function serializePostDraftPayload(payload: PostDraftPayload) {
  return {
    boardId: payload.boardId,
    title: payload.title,
    content: payload.content,
    richContent: payload.richContent,
    imageUrls: [...payload.imageUrls],
    pendingSticker: payload.pendingSticker,
    topicNames: [...payload.topicNames],
    expiryType: payload.expiryType,
  }
}

export function createStoredPostDraft(
  payload: PostDraftPayload,
  serverVersion: number | null,
  localUpdatedAt = new Date().toISOString(),
): StoredPostDraft {
  return {
    ...serializePostDraftPayload(payload),
    localUpdatedAt,
    serverVersion,
  }
}

export function postDraftPayloadKey(payload: PostDraftPayload) {
  return JSON.stringify(serializePostDraftPayload(payload))
}

export function hasMeaningfulPostDraftContent(payload: PostDraftPayload) {
  return Boolean(
    payload.title.trim()
    || payload.content.trim()
    || payload.richContent?.content.length
    || payload.imageUrls.length
    || payload.pendingSticker
    || payload.topicNames.length
    || payload.expiryType,
  )
}

export const POST_DRAFT_FIELDS: readonly (keyof PostDraftPayload)[] = [
  'boardId', 'title', 'content', 'richContent', 'imageUrls',
  'pendingSticker', 'topicNames', 'expiryType',
]

function postDraftFieldKey(value: unknown) {
  return JSON.stringify(value ?? null)
}

/**
 * Precedence for an ASYNCHRONOUS draft restore.
 *
 * `restoreDraft()` awaits GET /api/posts/draft while the form is already
 * rendered. Any choice the user makes before that request resolves (notably the
 * 限时发布 / expiryType selection, which decides whether a scheduled post is a
 * 限时今日帖子) belongs to the current editing session and must win over the
 * older server draft. Fields the user has not touched may still be restored.
 *
 * `publishMode` and `scheduledPublishLocal` are deliberately not part of
 * PostDraftPayload: they are session-level UI state, never persisted, so a
 * restore can never overwrite them either.
 *
 * `expiryType` is ALWAYS session-owned. It is a per-post, per-publication
 * decision (the limit starts counting when the post becomes public), so a
 * stale saved draft - server-side or browser-local - must never silently turn
 * an ordinary scheduled post into a 限时今日帖子. Only an explicit
 * conflict-resolution action may apply the persisted choice.
 */
export function mergeRestoredPostDraft(
  restored: PostDraftPayload,
  current: PostDraftPayload,
  baseline: PostDraftPayload,
): PostDraftPayload {
  const r = serializePostDraftPayload(restored)
  const c = serializePostDraftPayload(current)
  const b = serializePostDraftPayload(baseline)
  const resolveField = <K extends keyof PostDraftPayload>(field: K): PostDraftPayload[K] =>
    postDraftFieldKey(c[field]) === postDraftFieldKey(b[field]) ? r[field] : c[field]
  return {
    boardId: resolveField('boardId'),
    title: resolveField('title'),
    content: resolveField('content'),
    richContent: resolveField('richContent'),
    imageUrls: resolveField('imageUrls'),
    pendingSticker: resolveField('pendingSticker'),
    topicNames: resolveField('topicNames'),
    // Never resurrect a limited-time choice from a saved draft. The value in
    // `current` is whatever the user chose in this session (null by default).
    expiryType: c.expiryType,
  }
}

export function normalizeServerPostDraft(
  value: unknown,
  validBoardIds?: readonly string[],
): ServerPostDraft | null {
  if (!isRecord(value)) return null
  const payload = parsePostDraftPayload(value, validBoardIds)
  const id = typeof value.id === 'string' ? value.id : ''
  const version = Number.isInteger(value.version) ? Number(value.version) : 0
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : ''
  if (!payload || !id || version < 1 || Number.isNaN(Date.parse(updatedAt))) return null
  return { ...payload, id, version, updatedAt }
}
