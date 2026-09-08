'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContentImageUploader, type ContentImageUploaderHandle } from '@/components/ContentImageUploader'
import { RichTextEditor, type RichTextEditorHandle } from '@/components/posts/RichTextEditor'
import { StickerPicker, type PickerSticker } from '@/components/StickerPicker'
import { getPostCreateInitialBoardId } from '@/lib/boards'
import { publicImageVariantUrl } from '@/lib/image-variants'
import {
  createStoredPostDraft,
  hasMeaningfulPostDraftContent,
  normalizeServerPostDraft,
  parseStoredPostDraft,
  postDraftConflictStorageKey,
  postDraftPayloadKey,
  postDraftStorageKey,
  POST_DRAFT_AUTOSAVE_DEBOUNCE_MS,
  POST_DRAFT_LOCAL_CACHE_DEBOUNCE_MS,
  POST_DRAFT_STORAGE_KEY,
  type PostDraftPayload,
  type ServerPostDraft,
} from '@/lib/post-draft'
import { type RichTextContent } from '@/lib/rich-text'

type Board = { id: string; name: string; slug: string }

type DraftConflict = {
  latest: ServerPostDraft
  local: PostDraftPayload
}

export function PostCreateForm({
  userId,
  boards,
  initialBoardSlug,
}: Readonly<{ userId: string; boards: Board[]; initialBoardSlug?: string }>) {
  const router = useRouter()
  const imagesUploaderRef = useRef<ContentImageUploaderHandle>(null)
  const editorRef = useRef<RichTextEditorHandle>(null)
  const initialBoardIdRef = useRef(getPostCreateInitialBoardId(boards, initialBoardSlug))
  const [boardId, setBoardId] = useState(initialBoardIdRef.current)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [richContent, setRichContent] = useState<RichTextContent | null>(null)
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [pendingSticker, setPendingSticker] = useState<PickerSticker | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')
  const [draftConflict, setDraftConflict] = useState<DraftConflict | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [imagesUploading, setImagesUploading] = useState(false)
  const draftPublishedRef = useRef(false)
  const draftVersionRef = useRef<number | null>(null)
  const lastServerUpdatedAtRef = useRef<string | null>(null)
  const lastSyncedPayloadKeyRef = useRef<string | null>(null)
  const currentPayloadRef = useRef<PostDraftPayload>({
    boardId: initialBoardIdRef.current,
    title: '',
    content: '',
    richContent: null,
    imageUrls: [],
    pendingSticker: null,
  })
  const queuedSaveRef = useRef<PostDraftPayload | null>(null)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const draftConflictRef = useRef<DraftConflict | null>(null)
  const saveServerDraftRef = useRef<(payload: PostDraftPayload) => Promise<void>>(async () => undefined)

  const localStorageKey = postDraftStorageKey(userId)
  const legacyLocalStorageKey = POST_DRAFT_STORAGE_KEY
  const conflictStorageKey = postDraftConflictStorageKey(userId)
  const validBoardIds = useMemo(() => boards.map((board) => board.id), [boards])
  const validBoardIdsKey = validBoardIds.join('|')

  const currentPayload = useCallback((): PostDraftPayload => {
    return {
      boardId,
      title,
      content,
      richContent,
      imageUrls: [...imageUrls],
      pendingSticker: pendingSticker
        ? { id: pendingSticker.id, name: pendingSticker.name, url: pendingSticker.url, type: pendingSticker.type }
        : null,
    }
  }, [boardId, title, content, richContent, imageUrls, pendingSticker])

  const persistLocal = useCallback((payload: PostDraftPayload, serverVersion = draftVersionRef.current, key = localStorageKey) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(createStoredPostDraft(payload, serverVersion)))
    } catch {
      // Quota/private-mode failures do not block server sync or publishing.
    }
  }, [localStorageKey])

  function removeLocalDrafts() {
    try {
      window.localStorage.removeItem(localStorageKey)
      window.localStorage.removeItem(legacyLocalStorageKey)
      window.localStorage.removeItem(conflictStorageKey)
    } catch {
      // Storage failures do not change the successful publish result.
    }
  }

  const applyDraftPayload = useCallback((payload: PostDraftPayload) => {
    setBoardId(payload.boardId && validBoardIds.includes(payload.boardId) ? payload.boardId : initialBoardIdRef.current)
    setTitle(payload.title)
    setRichContent(payload.richContent)
    setContent(payload.content)
    setImageUrls(payload.imageUrls)
    setPendingSticker(payload.pendingSticker)
  }, [validBoardIds])

  function setConflict(value: DraftConflict | null) {
    draftConflictRef.current = value
    setDraftConflict(value)
  }

  async function saveServerDraft(payload: PostDraftPayload) {
    if (draftPublishedRef.current) return
    queuedSaveRef.current = payload
    if (saveInFlightRef.current) return saveInFlightRef.current

    const run = (async () => {
      while (queuedSaveRef.current && !draftPublishedRef.current) {
        const nextPayload = queuedSaveRef.current
        queuedSaveRef.current = null
        if (draftConflictRef.current) break
        if (!hasMeaningfulPostDraftContent(nextPayload)) {
          persistLocal(nextPayload)
          continue
        }
        if (lastSyncedPayloadKeyRef.current === postDraftPayloadKey(nextPayload) && draftVersionRef.current !== null) {
          persistLocal(nextPayload)
          continue
        }

        setDraftStatus('正在同步草稿…')
        let response: Response
        try {
          response = await fetch('/api/posts/draft', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...nextPayload,
              expectedVersion: draftVersionRef.current,
            }),
          })
        } catch {
          persistLocal(nextPayload)
          setDraftStatus('本地已保存，云端未同步；网络恢复后会自动重试')
          break
        }

        const data = await response.json().catch(() => ({})) as { draft?: unknown; message?: unknown; code?: unknown }
        if (response.status === 409 && data.code === 'DRAFT_CONFLICT') {
          const latest = normalizeServerPostDraft(data.draft, validBoardIds)
          if (latest) {
            persistLocal(nextPayload, draftVersionRef.current, conflictStorageKey)
            setConflict({ latest, local: nextPayload })
            setDraftStatus('这份草稿已在另一台设备更新；当前内容已保留在本机备份')
          } else {
            persistLocal(nextPayload)
            setDraftStatus('草稿版本发生冲突，本地内容已保留')
          }
          break
        }
        if (!response.ok) {
          persistLocal(nextPayload)
          setDraftStatus(typeof data.message === 'string' ? `${data.message}（本地已保存）` : '本地已保存，云端未同步')
          break
        }

        const saved = normalizeServerPostDraft(data.draft, validBoardIds)
        if (!saved) {
          persistLocal(nextPayload)
          setDraftStatus('本地已保存，云端返回格式异常')
          break
        }
        draftVersionRef.current = saved.version
        lastServerUpdatedAtRef.current = saved.updatedAt
        lastSyncedPayloadKeyRef.current = postDraftPayloadKey(saved)
        persistLocal(saved, saved.version)
        setConflict(null)
        setDraftStatus('已保存')
        try {
          // The legacy key has no account identity. It is removed only after
          // the account-scoped server save succeeds.
          window.localStorage.removeItem(legacyLocalStorageKey)
          window.localStorage.removeItem(conflictStorageKey)
        } catch {
          // The server is already authoritative; retaining a cache is safe.
        }
      }
    })()

    saveInFlightRef.current = run
    try {
      await run
    } finally {
      if (saveInFlightRef.current === run) saveInFlightRef.current = null
    }
  }

  saveServerDraftRef.current = saveServerDraft

  useEffect(() => {
    let cancelled = false
    async function restoreDraft() {
      setDraftReady(false)
      setConflict(null)
      let scopedLocal: ReturnType<typeof parseStoredPostDraft> = null
      let legacyLocal: ReturnType<typeof parseStoredPostDraft> = null
      try {
        scopedLocal = parseStoredPostDraft(window.localStorage.getItem(localStorageKey), validBoardIds)
        legacyLocal = parseStoredPostDraft(window.localStorage.getItem(legacyLocalStorageKey), validBoardIds)
      } catch {
        // Local storage can be unavailable in private browsing contexts.
      }
      const local = scopedLocal || legacyLocal

      try {
        const response = await fetch('/api/posts/draft', { cache: 'no-store' })
        if (!response.ok) throw new Error(`draft GET ${response.status}`)
        const data = await response.json() as { draft?: unknown }
        const server = normalizeServerPostDraft(data.draft, validBoardIds)
        if (cancelled) return

        if (server) {
          const serverPayload = server as PostDraftPayload
          const localDiffers = Boolean(local && postDraftPayloadKey(local) !== postDraftPayloadKey(serverPayload))
          if (localDiffers && local) {
            persistLocal(local, local.serverVersion, conflictStorageKey)
            setConflict({ latest: server, local })
          }
          applyDraftPayload(serverPayload)
          draftVersionRef.current = server.version
          lastServerUpdatedAtRef.current = server.updatedAt
          lastSyncedPayloadKeyRef.current = postDraftPayloadKey(serverPayload)
          persistLocal(serverPayload, server.version)
          try {
            // A server record is already authoritative, so an unscoped legacy
            // cache no longer needs to participate in future restores. A
            // differing copy was preserved above under the conflict key.
            window.localStorage.removeItem(legacyLocalStorageKey)
          } catch {
            // Cache cleanup is best effort.
          }
          setDraftStatus(localDiffers ? '已恢复云端草稿；本机未同步内容已保留备份' : '已恢复云端草稿')
        } else if (local) {
          applyDraftPayload(local)
          draftVersionRef.current = local.serverVersion
          lastServerUpdatedAtRef.current = null
          lastSyncedPayloadKeyRef.current = null
          setDraftStatus('已恢复本地草稿，正在同步云端…')
        }
      } catch {
        if (cancelled) return
        // The legacy key has no account identity. Only an account-scoped
        // cache is safe to restore while the authenticated server lookup is
        // unavailable; the legacy record remains for a successful migration
        // after the server confirms that this account has no draft.
        if (scopedLocal) {
          applyDraftPayload(scopedLocal)
          draftVersionRef.current = scopedLocal.serverVersion
          setDraftStatus('本地已保存，云端暂时无法读取')
        } else {
          setDraftStatus('云端草稿暂时无法读取，当前内容仍可本地保存')
        }
      } finally {
        if (!cancelled) setDraftReady(true)
      }
    }
    void restoreDraft()
    return () => {
      cancelled = true
    }
  }, [applyDraftPayload, conflictStorageKey, legacyLocalStorageKey, localStorageKey, persistLocal, validBoardIds, validBoardIdsKey])

  useEffect(() => {
    const payload = currentPayload()
    currentPayloadRef.current = payload
    if (!draftReady || draftPublishedRef.current) return

    const localTimer = window.setTimeout(() => persistLocal(payload), POST_DRAFT_LOCAL_CACHE_DEBOUNCE_MS)
    const serverTimer = window.setTimeout(() => {
      persistLocal(payload)
      if (draftConflictRef.current) return
      if (!hasMeaningfulPostDraftContent(payload) && draftVersionRef.current === null) return
      void saveServerDraftRef.current(payload)
    }, POST_DRAFT_AUTOSAVE_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(localTimer)
      window.clearTimeout(serverTimer)
    }
  }, [currentPayload, draftReady, persistLocal])

  useEffect(() => {
    function flushDraft() {
      if (!draftReady || draftPublishedRef.current) return
      const payload = currentPayloadRef.current
      persistLocal(payload)
      if (draftConflictRef.current) return
      if (hasMeaningfulPostDraftContent(payload)) void saveServerDraftRef.current(payload)
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') flushDraft()
    }
    function handleOnline() {
      const payload = currentPayloadRef.current
      if (!draftPublishedRef.current && !draftConflictRef.current && hasMeaningfulPostDraftContent(payload)) {
        void saveServerDraftRef.current(payload)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      flushDraft()
    }
  }, [draftReady, persistLocal])

  function useLatestServerDraft() {
    const conflict = draftConflictRef.current
    if (!conflict) return
    applyDraftPayload(conflict.latest)
    draftVersionRef.current = conflict.latest.version
    lastServerUpdatedAtRef.current = conflict.latest.updatedAt
    lastSyncedPayloadKeyRef.current = postDraftPayloadKey(conflict.latest)
    setConflict(null)
    persistLocal(conflict.latest, conflict.latest.version)
    setDraftStatus('已使用云端最新草稿')
    try {
      window.localStorage.removeItem(conflictStorageKey)
    } catch {
      // Backup cleanup is best effort.
    }
  }

  function keepLocalDraft() {
    const conflict = draftConflictRef.current
    if (!conflict) return
    applyDraftPayload(conflict.local)
    draftVersionRef.current = conflict.latest.version
    lastServerUpdatedAtRef.current = conflict.latest.updatedAt
    lastSyncedPayloadKeyRef.current = postDraftPayloadKey(conflict.latest)
    setConflict(null)
    persistLocal(conflict.local, conflict.latest.version)
    setDraftStatus('正在保存本机版本…')
    void saveServerDraftRef.current(conflict.local)
  }

  async function saveDraftNow() {
    if (draftConflictRef.current) {
      setDraftStatus('请先处理另一台设备产生的草稿冲突')
      return
    }
    const payload = currentPayloadRef.current
    persistLocal(payload)
    if (!hasMeaningfulPostDraftContent(payload)) {
      setDraftStatus('本地草稿已保存')
      return
    }
    setDraftStatus('正在保存…')
    await saveServerDraftRef.current(payload)
  }

  function addPastedImagesToAttachments(files: File[]) {
    imagesUploaderRef.current?.addFiles(files)
  }

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    if (imagesUploading) {
      setErrors({ form: '图片仍在处理中，请等待上传完成后再发布。' })
      return
    }
    setErrors({})
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, title, content, richContent, imageUrls, stickerId: pendingSticker?.id || undefined }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setErrors({ form: typeof data?.message === 'string' ? data.message : '发布帖子暂时失败，请稍后重试', ...data?.errors })
        return
      }
      const postId = typeof data?.post?.id === 'string' ? data.post.id : ''
      const isPending = data?.moderationStatus === 'PENDING' || data?.post?.moderationStatus === 'PENDING'
      if (!postId) {
        console.error('[post:create:invalid-response]', { hasPost: Boolean(data?.post), status: data?.moderationStatus })
        setErrors({ form: '帖子已提交，但跳转地址异常，请刷新帖子列表查看。' })
        return
      }

      // A successful Post create comes first. Only then clear the private
      // draft; a failed create therefore leaves both server and local copies.
      let draftCleared = false
      try {
        const clearResponse = await fetch('/api/posts/draft', { method: 'DELETE' })
        draftCleared = clearResponse.ok
        if (!draftCleared) console.error('[post:draft:clear-after-publish]', { status: clearResponse.status })
      } catch (error) {
        console.error('[post:draft:clear-after-publish]', { name: error instanceof Error ? error.name : 'unknown' })
      }
      draftPublishedRef.current = true
      if (draftCleared) removeLocalDrafts()

      if (isPending) {
        router.push(`/post/submitted?postId=${postId}&status=${data.moderationStatus}`)
      } else {
        const detailUrl = typeof data?.detailUrl === 'string' ? data.detailUrl : `/posts/${postId}`
        router.push(detailUrl)
      }
      router.refresh()
    } catch (error) {
      console.error('[post:create:request]', {
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error ? error.message : String(error),
      })
      setErrors({ form: '网络连接失败，请检查网络后重试' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submitPost} className="space-y-5 rounded-xl border border-sky-100 bg-white/82 p-6 shadow-sm">
      {errors.form ? <p className="text-sm font-bold text-red-600">{errors.form}</p> : null}
      {draftStatus ? <p className="rounded-lg bg-sky-50 px-4 py-2 text-sm font-bold text-brand-700" role="status">{draftStatus}</p> : null}
      {draftConflict ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
          <p className="font-black">这份草稿已在另一台设备更新。</p>
          <p className="mt-1">当前内容已保留在本机备份，请选择使用哪个版本。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={useLatestServerDraft} className="rounded-lg bg-brand-700 px-3 py-2 font-black text-white">使用云端最新</button>
            <button type="button" onClick={keepLocalDraft} className="rounded-lg border border-amber-300 px-3 py-2 font-black text-amber-900">保留当前内容并覆盖云端</button>
          </div>
        </div>
      ) : null}
      <label className="block">
        <span className="text-sm font-black text-slate-700">选择板块</span>
        <select value={boardId} onChange={(event) => setBoardId(event.target.value)} className="mt-2 w-full rounded-lg border border-sky-100 px-4 py-2">
          {boards.map((board) => (
            <option key={board.id} value={board.id}>{board.name}</option>
          ))}
        </select>
        {errors.boardId ? <p className="mt-2 text-sm font-bold text-red-600">{errors.boardId}</p> : null}
      </label>
      <ContentImageUploader ref={imagesUploaderRef} value={imageUrls} onChange={setImageUrls} onBusyChange={setImagesUploading} />
      <label className="block">
        <span className="text-sm font-black text-slate-700">标题</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-sky-100 px-4 py-2" placeholder="请输入帖子标题" />
        {errors.title ? <p className="mt-2 text-sm font-bold text-red-600">{errors.title}</p> : null}
      </label>
      <div className="block">
        <span className="text-sm font-black text-slate-700">正文</span>
        <div className="mt-2">
          {draftReady ? (
            <RichTextEditor
              ref={editorRef}
              initialContent={content}
              initialRichContent={richContent}
              onChange={(nextRichContent, plainText) => {
                setRichContent(nextRichContent)
                setContent(plainText)
              }}
              pasteImagesToAttachments
              onPasteImagesToAttachments={addPastedImagesToAttachments}
            />
          ) : <div className="rich-text-editor-loading" aria-live="polite">正在恢复草稿…</div>}
        </div>
        {errors.content ? <p className="mt-2 text-sm font-bold text-red-600">{errors.content}</p> : null}
      </div>
      {pendingSticker ? (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-brand-100 bg-sky-50 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicImageVariantUrl(pendingSticker.url, 'thumb-sm') || pendingSticker.url} alt={pendingSticker.name || '表情'} className="h-10 w-10 rounded-lg bg-white object-contain" />
          <span className="text-sm font-bold text-slate-600">已选择表情，点击发布发送</span>
          <button type="button" onClick={() => setPendingSticker(null)} className="ml-auto text-sm font-black text-slate-400 hover:text-red-500">移除</button>
        </div>
      ) : null}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void saveDraftNow()} className="inline-flex h-10 items-center rounded-lg border border-sky-200 px-3 text-sm font-black text-brand-700 transition hover:bg-sky-50">
            保存草稿
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPickerOpen((value) => !value)}
            className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-black text-slate-600 transition hover:bg-slate-50"
            aria-label="选择表情"
            aria-expanded={pickerOpen}
          >
            😊 表情
          </button>
        </div>
        <button disabled={isSubmitting || imagesUploading} className="rounded-lg bg-brand-700 px-5 py-3 font-black text-white disabled:opacity-60">
          {isSubmitting ? '发布中...' : imagesUploading ? '图片处理中...' : '发布帖子'}
        </button>
        <StickerPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelectSticker={(sticker) => {
            setPendingSticker(sticker)
            setPickerOpen(false)
          }}
          onSelectEmoji={(emoji) => editorRef.current?.insertText(emoji)}
        />
      </div>
    </form>
  )
}
