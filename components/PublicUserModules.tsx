'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ModuleFallback } from '@/components/ModuleFallback'
import { Pagination } from '@/components/ui/Pagination'
import { getMoodDisplay } from '@/lib/checkin-mood'
import { formatUid } from '@/lib/uid'
import { PROFILE_RECORD_PAGE_SIZE, type ProfileRecentMessage, type ProfileRecordPagination } from '@/lib/profile-page'
import { scrollToSectionTop } from '@/lib/pagination'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { IpRegionLabel } from '@/components/IpRegionLabel'
import { PersonalPostPinMenu } from '@/components/PostActions'
import { BadgeCollectionPanel } from '@/components/BadgeCollectionPanel'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { type PublicProfileModuleKey } from '@/lib/user-privacy-types'
import { ProfileRecordSettings } from '@/components/ProfileRecordSettings'
import { getOrderedProfileRecordSectionKeys, getProfileRecordLabel, normalizeProfileRecordPreferences, PROFILE_RECORD_SECTIONS, type ProfileRecordPreference } from '@/lib/profile-record-sections'
import type { ProfilePostGroupView } from '@/lib/profile-post-groups'
import { PersonalPostGroupMenu, ProfilePostGroupBar } from '@/components/ProfilePostGroups'
import { formatSalonPostContext, type SalonPostView } from '@/lib/salon-shared'
import { SalonLikeButton } from '@/components/salon/SalonLikeButton'
import { UiIcon } from '@/components/UiIcon'

type ModuleKey = PublicProfileModuleKey
const ALL_MODULE_KEYS: ModuleKey[] = PROFILE_RECORD_SECTIONS.map((section) => section.key) as ModuleKey[]
type PostItem = {
  id: string
  title: string
  content: string
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'VIOLATION'
  rejectionReason: string | null
  ipRegion: string | null
  replyCount: number
  likeCount: number
  viewCount: number
  isProfilePinned: boolean
  userPostGroupId: string | null
  board?: { name: string }
}
type ReplyItem = { id: string; content: string; post: { id: string; title: string } }
type AchievementItem = { id: string; achievement: { title: string; icon: string | null; rarity: string } }
type BadgeItem = { id: string; badge: { name: string; description: string | null } }
type AlbumItem = { id: string; note: string | null; album: { title: string; slug: string } }
type FavoriteItem = {
  id: string
  post: {
    id: string
    title: string
    content: string
    author: { uid: number; nickname: string; profile?: { displayName: string | null } | null; equippedBadges?: EquippedBadgeView[]; equippedBadge?: EquippedBadgeView | null }
  }
}
type ModuleItem = PostItem | ReplyItem | ProfileRecentMessage | AchievementItem | BadgeItem | AlbumItem | FavoriteItem | SalonPostView
type PaginatedModuleKey = 'posts' | 'recent-messages' | 'salon'
type ModuleState = { loading: boolean; failed: boolean; items: ModuleItem[]; pagination?: ProfileRecordPagination; postGroups?: ProfilePostGroupView[] }
type CacheState = Record<string, ModuleState | undefined>

function isPaginatedModule(moduleKey: ModuleKey): moduleKey is PaginatedModuleKey {
  return moduleKey === 'posts' || moduleKey === 'recent-messages' || moduleKey === 'salon'
}

const ALL_POST_GROUPS = ''

function moduleCacheKey(moduleKey: ModuleKey, page: number, postGroupId = ALL_POST_GROUPS) {
  return isPaginatedModule(moduleKey)
    ? moduleKey === 'posts' ? `${moduleKey}:${page}:${postGroupId || 'all'}` : `${moduleKey}:${page}`
    : moduleKey
}

function moduleLabel(moduleKey: ModuleKey, isSelf: boolean) {
  return getProfileRecordLabel(moduleKey, isSelf)
}

export function PublicUserModules({ uid, isSelf, visibleModules, recordPreferences, recentMessages = [], recentMessagesPagination, initialModule, initialPage, initialGroupId }: { uid: string; isSelf: boolean; visibleModules?: readonly ModuleKey[]; recordPreferences?: readonly ProfileRecordPreference[]; recentMessages?: ProfileRecentMessage[]; recentMessagesPagination?: ProfileRecordPagination; initialModule?: string; initialPage?: number;     initialGroupId?: string }) {
  const router = useRouter()
  const [recordLayout, setRecordLayout] = useState<ProfileRecordPreference[]>(() => recordPreferences?.length ? [...recordPreferences] : normalizeProfileRecordPreferences([]))
  const visibleModuleKeys = useMemo(() => {
    const allowed = new Set(visibleModules || PROFILE_RECORD_SECTIONS.map((section) => section.key))
    const hidden = new Map(recordLayout.map((preference) => [preference.key, preference.visible]))
    return getOrderedProfileRecordSectionKeys(recordLayout, isSelf).filter((moduleKey) => allowed.has(moduleKey) && (isSelf || hidden.get(moduleKey) !== false))
  }, [isSelf, recordLayout, visibleModules])
  const visibleTabs = useMemo(() => visibleModuleKeys.map((moduleKey) => PROFILE_RECORD_SECTIONS.find((tab) => tab.key === moduleKey)).filter((tab): tab is typeof PROFILE_RECORD_SECTIONS[number] => Boolean(tab)), [visibleModuleKeys])
  const firstVisibleModule = visibleModuleKeys[0] || 'posts'
  // #5 分页返回状态：初始 active / 页码来自 URL searchParams（服务端透传），
  // 这样从帖子详情页 browser back 回来时，服务端已按 URL 渲染出正确的 Tab / 页码。
  const [active, setActive] = useState<ModuleKey>(
    initialModule && ALL_MODULE_KEYS.includes(initialModule as ModuleKey) ? (initialModule as ModuleKey) : firstVisibleModule,
  )
  const [modulePages, setModulePages] = useState<Record<PaginatedModuleKey, number>>({
    posts: initialModule === 'posts' ? Math.max(1, Math.trunc(initialPage || 1) || 1) : 1,
    'recent-messages': recentMessagesPagination?.page || 1,
    salon: 1,
  })
  const [postGroupFilter, setPostGroupFilter] = useState(initialGroupId || ALL_POST_GROUPS)
  const [postGroups, setPostGroups] = useState<ProfilePostGroupView[]>([])
  const [expandedRecentMessages, setExpandedRecentMessages] = useState<Record<string, boolean>>({})
  const [deleteTarget, setDeleteTarget] = useState<ProfileRecentMessage | null>(null)
  const [isDeletingRecentMessage, setIsDeletingRecentMessage] = useState(false)
  const [recentMessageNotice, setRecentMessageNotice] = useState('')
  const [recentMessageError, setRecentMessageError] = useState('')
  // #3 个人主页「管理」模式：批量删除自己的帖子。
  const [manageMode, setManageMode] = useState(false)
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState('')
  const [bulkDeleteError, setBulkDeleteError] = useState('')
  // #5 返回时 best-effort 恢复滚动位置所用的 sessionStorage key。
  const scrollRestoreKey = `profile-scroll:${uid}`
  const modulesSectionRef = useRef<HTMLElement>(null)
  const initialRecentPage = recentMessagesPagination?.page || 1
  const [cache, setCache] = useState<CacheState>(() => ({
    [moduleCacheKey('recent-messages', initialRecentPage)]: { loading: false, failed: false, items: recentMessages, pagination: recentMessagesPagination },
  }))
  const activePage = isPaginatedModule(active) ? modulePages[active] : 1
  const state = cache[moduleCacheKey(active, activePage, active === 'posts' ? postGroupFilter : ALL_POST_GROUPS)]

  // #5 浏览器前进/后退时，以 URL 的 module/page/groupId 为准同步本地 state。
  // 不依赖 useSearchParams（避免预渲染 Suspense 约束），改用 popstate 监听 + 挂载时同步。
  const visibleModuleKeysRef = useRef(visibleModuleKeys)
  visibleModuleKeysRef.current = visibleModuleKeys
  const syncStateFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    const urlModule = params.get('module')
    const urlPageRaw = Number(params.get('page'))
    const urlPage = Number.isFinite(urlPageRaw) && urlPageRaw > 0 ? Math.trunc(urlPageRaw) : 1
    const urlGroupId = params.get('groupId') || ALL_POST_GROUPS
    if (urlModule && ALL_MODULE_KEYS.includes(urlModule as ModuleKey) && visibleModuleKeysRef.current.includes(urlModule as ModuleKey)) {
      setActive((current) => (current === urlModule ? current : (urlModule as ModuleKey)))
      if (urlModule === 'posts') setPostGroupFilter((current) => (current === urlGroupId ? current : urlGroupId))
    }
    if (urlModule === 'posts' && urlPage > 1) {
      setModulePages((current) => (current.posts === urlPage ? current : { ...current, posts: urlPage }))
    }
  }, [])
  useEffect(() => {
    syncStateFromUrl()
    window.addEventListener('popstate', syncStateFromUrl)
    return () => window.removeEventListener('popstate', syncStateFromUrl)
  }, [syncStateFromUrl])

  // 若当前 active 在可见模块之外（例如用户隐藏了某模块），回退到第一个可见模块。
  useEffect(() => {
    if (!visibleModuleKeys.includes(active)) setActive(firstVisibleModule)
  }, [active, firstVisibleModule, visibleModuleKeys])

  // #5 用户切换标签/翻页/切换分组时，把状态写回 URL（不滚动，自行控制滚动恢复）。
  const syncUrlFromState = useCallback(() => {
    const params = new URLSearchParams()
    if (active !== firstVisibleModule) params.set('module', active)
    if (active === 'posts') {
      if (modulePages.posts > 1) params.set('page', String(modulePages.posts))
      if (postGroupFilter && postGroupFilter !== ALL_POST_GROUPS) params.set('groupId', postGroupFilter)
    }
    const query = params.toString()
    const target = `/user/${uid}${query ? `?${query}` : ''}`
    const current = `/user/${uid}${window.location.search}`
    if (target !== current) router.replace(target, { scroll: false })
  }, [active, modulePages, postGroupFilter, uid, router, firstVisibleModule])
  useEffect(() => { syncUrlFromState() }, [syncUrlFromState])

  // #5 返回个人主页时 best-effort 恢复滚动位置（仅当存在与当前 module/page/group 匹配的保存项）。
  useEffect(() => {
    if (!isSelf) return
    try {
      const raw = window.sessionStorage.getItem(scrollRestoreKey)
      if (!raw) return
      const saved = JSON.parse(raw) as { module?: string; page?: number; groupId?: string; y?: number }
      const groupOk = active !== 'posts' || (saved.groupId || ALL_POST_GROUPS) === postGroupFilter
      const pageOk = active !== 'posts' || saved.page === modulePages.posts
      if (saved.module !== active || !pageOk || !groupOk) return
      if (!state || state.loading) return
      if (typeof saved.y === 'number') window.scrollTo({ top: saved.y, behavior: 'auto' })
      window.sessionStorage.removeItem(scrollRestoreKey)
    } catch { /* ignore */ }
  }, [active, modulePages, postGroupFilter, state, isSelf, scrollRestoreKey])

  const handlePostNavigate = useCallback(() => {
    if (manageMode) return
    try {
      window.sessionStorage.setItem(scrollRestoreKey, JSON.stringify({
        module: active,
        page: active === 'posts' ? modulePages.posts : 1,
        groupId: active === 'posts' ? postGroupFilter : ALL_POST_GROUPS,
        y: window.scrollY,
      }))
    } catch { /* ignore */ }
  }, [active, modulePages, postGroupFilter, manageMode, scrollRestoreKey])

  const loadModule = useCallback(async (moduleKey: ModuleKey, requestedPage = 1, scrollAfterLoad = false, requestedGroupId = postGroupFilter) => {
    if (!visibleModuleKeys.includes(moduleKey)) return
    const requestedCacheKey = moduleCacheKey(moduleKey, requestedPage, moduleKey === 'posts' ? requestedGroupId : ALL_POST_GROUPS)
    setCache((current) => ({
      ...current,
      [requestedCacheKey]: {
        loading: true,
        failed: false,
        items: current[requestedCacheKey]?.items || [],
        pagination: current[requestedCacheKey]?.pagination,
      },
    }))

    try {
      const params = new URLSearchParams({ module: moduleKey })
      if (isPaginatedModule(moduleKey)) {
        params.set('page', String(Math.max(1, Math.trunc(requestedPage) || 1)))
        params.set('pageSize', String(PROFILE_RECORD_PAGE_SIZE))
      }
      if (moduleKey === 'posts' && requestedGroupId) params.set('groupId', requestedGroupId)
      const response = await fetch(`/api/users/${uid}/public-modules?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(moduleKey)
      const data = await response.json() as { items?: ModuleItem[]; pagination?: ProfileRecordPagination; groups?: ProfilePostGroupView[] }
      const items = Array.isArray(data.items) ? data.items : []
      const pagination = data.pagination
      const resolvedPage = pagination?.page || requestedPage
      const resolvedCacheKey = moduleCacheKey(moduleKey, resolvedPage, moduleKey === 'posts' ? requestedGroupId : ALL_POST_GROUPS)
      if (moduleKey === 'posts' && Array.isArray(data.groups)) setPostGroups(data.groups)
      setModulePages((current) => isPaginatedModule(moduleKey) ? { ...current, [moduleKey]: resolvedPage } : current)
      setCache((current) => ({
        ...current,
        [requestedCacheKey]: { loading: false, failed: false, items, pagination, ...(moduleKey === 'posts' ? { postGroups: data.groups || [] } : {}) },
        [resolvedCacheKey]: { loading: false, failed: false, items, pagination, ...(moduleKey === 'posts' ? { postGroups: data.groups || [] } : {}) },
      }))
      if (scrollAfterLoad) {
        window.requestAnimationFrame(() => scrollToSectionTop(modulesSectionRef.current))
      }
    } catch {
      setCache((current) => ({ ...current, [requestedCacheKey]: { loading: false, failed: true, items: [] } }))
    }
  }, [postGroupFilter, uid, visibleModuleKeys])

  useEffect(() => {
    if (!visibleModuleKeys.length || !visibleModuleKeys.includes(active)) return
    if (state) return
    void loadModule(active, activePage)
  }, [active, activePage, loadModule, state, visibleModuleKeys])

  function handlePageChange(nextPage: number) {
    if (!isPaginatedModule(active) || !state?.pagination) return
    const safePage = Math.min(Math.max(1, Math.trunc(nextPage) || 1), state.pagination.totalPages)
    if (safePage === activePage) return
    setModulePages((current) => ({ ...current, [active]: safePage }))
    void loadModule(active, safePage, true, active === 'posts' ? postGroupFilter : ALL_POST_GROUPS)
  }

  const handlePostGroupChange = useCallback((nextGroupId: string) => {
    setSelectedPostIds(new Set())
    setPostGroupFilter(nextGroupId)
    setModulePages((current) => ({ ...current, posts: 1 }))
    void loadModule('posts', 1, true, nextGroupId)
  }, [loadModule])

  const handlePostGroupsChanged = useCallback(() => {
    const currentPostsPage = modulePages.posts
    void loadModule('posts', 1, false, postGroupFilter)
    if (currentPostsPage > 1) void loadModule('posts', currentPostsPage, false, postGroupFilter)
  }, [loadModule, modulePages.posts, postGroupFilter])

  const handleProfilePinChanged = useCallback(() => {
    const currentPostsPage = modulePages.posts
    void loadModule('posts', 1)
    if (currentPostsPage > 1) void loadModule('posts', currentPostsPage, false, postGroupFilter)
  }, [loadModule, modulePages.posts, postGroupFilter])

  const removeRecentMessageFromCache = useCallback((messageId: string) => {
    setCache((current) => {
      const hasMessageInRecentCache = Object.entries(current).some(([key, value]) => (
        key.startsWith('recent-messages:') && Boolean(value?.items.some((item) => item.id === messageId))
      ))
      const next: CacheState = {}
      for (const [key, value] of Object.entries(current)) {
        if (!value) continue
        const isRecentMessagesCache = key.startsWith('recent-messages:')
        const items = isRecentMessagesCache ? value.items.filter((item) => item.id !== messageId) : value.items
        const pagination = value.pagination
        const total = pagination && isRecentMessagesCache
          ? Math.max(0, pagination.total - (hasMessageInRecentCache ? 1 : 0))
          : undefined
        const totalPages = pagination ? Math.max(1, Math.ceil((total || 0) / pagination.pageSize)) : undefined
        next[key] = {
          ...value,
          items,
          ...(pagination && total !== undefined && totalPages !== undefined
            ? { pagination: { ...pagination, total, totalPages, hasMore: pagination.page < totalPages } }
            : {}),
        }
      }
      return next
    })
  }, [])

  async function confirmDeleteRecentMessage() {
    if (!deleteTarget || isDeletingRecentMessage) return
    const messageId = deleteTarget.id
    setIsDeletingRecentMessage(true)
    setRecentMessageNotice('')
    setRecentMessageError('')
    try {
      const response = await fetch(`/api/daily-messages/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '删除失败，请稍后重试')

      const recentPage = modulePages['recent-messages']
      const recentState = cache[moduleCacheKey('recent-messages', recentPage)]
      const deletedVisibleMessage = Boolean(recentState?.items.some((item) => item.id === messageId))
      const nextTotalPages = recentState?.pagination && deletedVisibleMessage
        ? Math.max(1, Math.ceil(Math.max(0, recentState.pagination.total - 1) / recentState.pagination.pageSize))
        : recentState?.pagination?.totalPages || 1
      removeRecentMessageFromCache(messageId)
      setExpandedRecentMessages((current) => {
        const next = { ...current }
        delete next[messageId]
        return next
      })
      if (recentPage > nextTotalPages) {
        const nextPage = Math.max(1, nextTotalPages)
        setModulePages((current) => ({ ...current, 'recent-messages': nextPage }))
        void loadModule('recent-messages', nextPage)
      }
      setRecentMessageNotice('留言已删除')
      setDeleteTarget(null)
    } catch (error) {
      setRecentMessageError(error instanceof Error ? error.message : '删除失败，请稍后重试')
      setDeleteTarget(null)
    } finally {
      setIsDeletingRecentMessage(false)
    }
  }

  // #3 个人主页批量删除自己的帖子（管理模式下）。
  const currentPostItems = active === 'posts' && state ? (state.items as PostItem[]) : []
  const allCurrentPostIds = currentPostItems.map((post) => post.id)
  const allSelected = allCurrentPostIds.length > 0 && allCurrentPostIds.every((id) => selectedPostIds.has(id))

  function toggleManageMode() {
    setManageMode((current) => {
      const next = !current
      if (!next) setSelectedPostIds(new Set())
      return next
    })
  }
  function toggleSelectPost(postId: string) {
    setSelectedPostIds((current) => {
      const next = new Set(current)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }
  function toggleSelectAllCurrent() {
    setSelectedPostIds((current) => {
      if (allSelected) {
        const next = new Set(current)
        allCurrentPostIds.forEach((id) => next.delete(id))
        return next
      }
      const next = new Set(current)
      allCurrentPostIds.forEach((id) => next.add(id))
      return next
    })
  }
  function handleProfilePostDeleted() {
    // #4 个人主页单帖删除：仅刷新发帖记录列表，绝不跳转。
    setBulkDeleteNotice('帖子已删除')
    void loadModule('posts', modulePages.posts, false, postGroupFilter)
  }
  async function confirmBulkDeleteUserPosts() {
    if (bulkDeleting || selectedPostIds.size === 0) return
    setBulkDeleting(true)
    setBulkDeleteNotice('')
    setBulkDeleteError('')
    try {
      const response = await fetch('/api/users/me/posts/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ postIds: Array.from(selectedPostIds) }),
      })
      const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; deleted?: number }
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '批量删除失败，请稍后重试')
      setBulkDeleteNotice(`已删除 ${data.deleted ?? selectedPostIds.size} 篇帖子`)
      setManageMode(false)
      setSelectedPostIds(new Set())
      setBulkDeleteConfirm(false)
      // 仅就地刷新当前发帖记录页，保持 Tab 与页码（服务端会夹紧到有效页）。
      void loadModule('posts', modulePages.posts, false, postGroupFilter)
    } catch (error) {
      setBulkDeleteError(error instanceof Error ? error.message : '批量删除失败，请稍后重试')
      setBulkDeleteConfirm(false)
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <>
<section ref={modulesSectionRef} id="profile-modules" className="h-full min-w-0 scroll-mt-24">
{isSelf ? <ProfileRecordSettings initialPreferences={recordLayout} onSaved={setRecordLayout} /> : null}
<div className="flex flex-wrap gap-2 border border-[var(--border)] border-b-0 bg-[var(--surface)] p-2">
          {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              // 离开发帖记录 Tab 时退出管理模式并清空选择，避免跨模块残留。
              if (tab.key !== 'posts' && active === 'posts' && manageMode) {
                setManageMode(false)
                setSelectedPostIds(new Set())
              }
              setActive(tab.key)
            }}
            className={`max-w-full rounded-none border px-3 py-2 text-xs font-black whitespace-nowrap transition sm:px-4 sm:text-sm ${active === tab.key ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-transparent bg-transparent text-[var(--primary)] hover:bg-[var(--surface-subtle)]'}`}
          >
            {isSelf ? tab.selfLabel : tab.otherLabel}
            {isSelf && recordLayout.find((preference) => preference.key === tab.key)?.visible === false ? '（已隐藏）' : null}
          </button>
        ))}
      </div>

<div className="min-w-0 border-x border-b border-[var(--border)] bg-[var(--surface)] p-4 shadow-none sm:p-5">
      {!visibleTabs.length ? <ModuleFallback title="该用户暂未公开个人记录。" /> : null}
      {recentMessageNotice ? <p role="status" className="mb-3 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">{recentMessageNotice}</p> : null}
      {recentMessageError ? <p role="alert" className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-600">{recentMessageError}</p> : null}
      {visibleTabs.length > 0 && state?.failed ? <ModuleFallback /> : null}
        {visibleTabs.length > 0 && (state?.loading || !state) ? <ModuleFallback title="正在加载..." /> : null}
        {isSelf && active === 'posts' ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {!manageMode ? (
              <button type="button" onClick={toggleManageMode} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-black text-[var(--primary)] disabled:opacity-60">管理</button>
            ) : (
              <>
                <label className="inline-flex items-center gap-2 text-sm font-black text-brand-950">
                  <input type="checkbox" className="size-4" checked={allSelected} onChange={toggleSelectAllCurrent} /> 本页全选
                </label>
                <span className="text-sm font-bold text-slate-600">已选择 {selectedPostIds.size} 篇</span>
                <button type="button" onClick={() => setBulkDeleteConfirm(true)} disabled={selectedPostIds.size === 0 || bulkDeleting} className="rounded-sm border border-[var(--danger)] bg-[var(--danger)] px-4 py-2 text-sm font-black text-white disabled:opacity-50">删除</button>
                <button type="button" onClick={toggleManageMode} disabled={bulkDeleting} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-black text-[var(--foreground)] disabled:opacity-60">完成</button>
              </>
            )}
            {bulkDeleteNotice ? <p role="status" className="w-full text-sm font-black text-emerald-700">{bulkDeleteNotice}</p> : null}
            {bulkDeleteError ? <p role="alert" className="w-full text-sm font-black text-red-600">{bulkDeleteError}</p> : null}
          </div>
        ) : null}
        {visibleTabs.length > 0 && state && !state.loading && !state.failed ? (
          <ModuleContent
            moduleKey={active}
            uid={uid}
            items={state.items}
            isSelf={isSelf}
            pagination={state.pagination}
            currentPage={activePage}
            postGroups={postGroups}
            activePostGroupId={postGroupFilter}
            onPostGroupChange={handlePostGroupChange}
            onPostGroupsChanged={handlePostGroupsChanged}
            onPageChange={handlePageChange}
            onProfilePinChanged={handleProfilePinChanged}
            manageMode={manageMode}
            selectedPostIds={selectedPostIds}
            onToggleSelect={toggleSelectPost}
            onPostNavigate={handlePostNavigate}
            onProfilePostDeleted={handleProfilePostDeleted}
            expandedRecentMessages={expandedRecentMessages}
            onToggleRecentMessage={(messageId) => setExpandedRecentMessages((current) => ({ ...current, [messageId]: !current[messageId] }))}
            onRequestDeleteRecentMessage={isSelf ? (message) => { setRecentMessageNotice(''); setRecentMessageError(''); setDeleteTarget(message) } : undefined}
            deletingRecentMessageId={isDeletingRecentMessage ? deleteTarget?.id || null : null}
          />
        ) : null}
      </div>
    </section>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除挂号留言？"
        description="删除后将无法恢复，但不会影响该日的挂号记录、连续签到和已获得奖励。"
        confirmLabel="确认删除"
        cancelLabel="取消"
        loading={isDeletingRecentMessage}
        onConfirm={() => void confirmDeleteRecentMessage()}
        onCancel={() => { if (!isDeletingRecentMessage) setDeleteTarget(null) }}
      />
      <ConfirmDialog
        open={bulkDeleteConfirm}
        title="批量删除帖子"
        description={`确定要删除选中的 ${selectedPostIds.size} 篇帖子吗？删除后无法恢复。`}
        confirmLabel="确认删除"
        cancelLabel="取消"
        loading={bulkDeleting}
        onConfirm={() => void confirmBulkDeleteUserPosts()}
        onCancel={() => { if (!bulkDeleting) setBulkDeleteConfirm(false) }}
      />
    </>
  )
}

function ModuleContent({
  moduleKey,
  uid,
  items,
  isSelf,
  pagination,
  currentPage,
  postGroups,
  activePostGroupId,
  onPostGroupChange,
  onPostGroupsChanged,
  onPageChange,
  onProfilePinChanged,
  manageMode,
  selectedPostIds,
  onToggleSelect,
  onPostNavigate,
  onProfilePostDeleted,
  expandedRecentMessages,
  onToggleRecentMessage,
  onRequestDeleteRecentMessage,
  deletingRecentMessageId,
}: {
  moduleKey: ModuleKey
  uid: string
  items: ModuleItem[]
  isSelf: boolean
  pagination?: ProfileRecordPagination
  currentPage: number
  postGroups: ProfilePostGroupView[]
  activePostGroupId: string
  onPostGroupChange: (groupId: string) => void
  onPostGroupsChanged: () => void
  onPageChange: (page: number) => void
  onProfilePinChanged: () => void
  manageMode: boolean
  selectedPostIds: Set<string>
  onToggleSelect: (postId: string) => void
  onPostNavigate: () => void
  onProfilePostDeleted: () => void
  expandedRecentMessages: Record<string, boolean>
  onToggleRecentMessage: (messageId: string) => void
  onRequestDeleteRecentMessage?: (message: ProfileRecentMessage) => void
  deletingRecentMessageId?: string | null
}) {
  if (moduleKey !== 'badges' && moduleKey !== 'posts' && !items.length) return <ModuleFallback title={`${moduleLabel(moduleKey, isSelf)}暂时没有内容。`} />

  const pageNavigation = isPaginatedModule(moduleKey) && pagination && pagination.totalPages > 1 ? (
    <Pagination
      currentPage={currentPage}
      totalPages={pagination.totalPages}
      onPageChange={onPageChange}
      ariaLabel={moduleKey === 'posts' ? 'posts pagination' : 'check-in messages pagination'}
    />
  ) : null

  if (moduleKey === 'posts') {
    const posts = items as PostItem[]
    return (
      <div className="space-y-3">
        <ProfilePostGroupBar
          groups={postGroups}
          activeGroupId={activePostGroupId}
          isSelf={isSelf}
          onSelect={onPostGroupChange}
          onChanged={onPostGroupsChanged}
        />
        {!posts.length ? <ModuleFallback title="该分组暂时没有帖子。" /> : null}
        {posts.map((post) => (
          <article key={post.id} className="relative min-w-0 border border-[var(--border)] bg-[var(--surface-subtle)]">
            {manageMode ? (
              <label className="flex min-w-0 cursor-pointer gap-3 p-3">
                <input type="checkbox" className="mt-1 size-4 shrink-0" checked={selectedPostIds.has(post.id)} onChange={() => onToggleSelect(post.id)} />
                <div className="min-w-0">
                  <p className="text-xs font-black text-brand-700">{post.board?.name}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {post.isProfilePinned ? <span className="rounded-sm bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">置顶</span> : null}
                    <h3 className="text-lg font-black text-brand-950">{post.title}</h3>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
                </div>
              </label>
            ) : (
              <>
                <Link href={`/posts/${post.id}`} className="block min-w-0 p-3 pr-40" onClick={onPostNavigate}>
                  <p className="text-xs font-black text-brand-700">{post.board?.name}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {post.isProfilePinned ? <span className="rounded-sm bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">置顶</span> : null}
                    <h3 className="text-lg font-black text-brand-950">{post.title}</h3>
                    {isSelf && post.moderationStatus === 'PENDING' ? <span className="rounded-sm bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">审核中</span> : null}
                    {isSelf && post.moderationStatus === 'REJECTED' ? <span className="rounded-sm bg-red-50 px-2 py-1 text-xs font-black text-red-700">审核未通过</span> : null}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
                  {isSelf && post.moderationStatus === 'REJECTED' && post.rejectionReason ? <p className="mt-2 text-xs font-bold text-red-700">{post.rejectionReason}</p> : null}
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500">
                    <span>回复 {post.replyCount} · 赞 {post.likeCount} · 浏览 {post.viewCount}</span>
                  </p>
                </Link>
                {isSelf ? (
                  <div className="absolute right-2 top-2 flex max-w-[45%] flex-wrap items-start justify-end gap-1">
                    <PersonalPostGroupMenu
                      postId={post.id}
                      currentGroupId={post.userPostGroupId}
                      groups={postGroups}
                      onChanged={onPostGroupsChanged}
                    />
                    <PersonalPostPinMenu
                      postId={post.id}
                      initialIsPinned={post.isProfilePinned}
                      onChanged={onProfilePinChanged}
                      onDeleted={onProfilePostDeleted}
                    />
                  </div>
                ) : null}
              </>
            )}
          </article>
        ))}
        {pageNavigation}
      </div>
    )
  }

  if (moduleKey === 'replies') {
    const replies = items as ReplyItem[]
    return (
      <div className="space-y-3">
        {replies.map((reply) => (
<Link
  key={reply.id}
  href={`/posts/${reply.post.id}`}
  className="block border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
>            <p className="font-black text-brand-950">{reply.post.title}</p>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{reply.content}</p>
          </Link>
        ))}
      </div>
    )
  }

  if (moduleKey === 'recent-messages') {
    const messages = items as ProfileRecentMessage[]
    return (
      <div className="space-y-3">
        {messages.map((message) => {
          const mood = getMoodDisplay(message)
          return (
          <article key={message.id} className="min-w-0 border border-[var(--border)] bg-[var(--surface-subtle)] p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black text-brand-950">
              {mood.formatted ? <span className="rounded-sm bg-sky-50 px-2 py-1 text-brand-700">{mood.formatted}</span> : null}
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN')}</time>
              <IpRegionLabel ipRegion={message.ipRegion} />
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{message.content}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
              <span>赞 {message.likeCount}</span>
              {message.commentCount > 0 || message.comments.length > 0 ? (
                <button type="button" onClick={() => onToggleRecentMessage(message.id)} className="text-brand-700">
                  回复 {message.commentCount}
                  <span className="ml-1">{expandedRecentMessages[message.id] ? '收起' : '查看'}</span>
                </button>
              ) : <span>回复 0</span>}
              {isSelf && onRequestDeleteRecentMessage ? (
                <button
                  type="button"
                  aria-label="删除留言"
                  onClick={() => onRequestDeleteRecentMessage(message)}
                  disabled={deletingRecentMessageId === message.id}
                  className="ml-auto inline-flex min-h-8 shrink-0 items-center rounded-sm bg-red-50 px-2.5 py-1 text-xs font-black text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingRecentMessageId === message.id ? '删除中…' : '删除'}
                </button>
              ) : null}
            </div>
            {expandedRecentMessages[message.id] ? (
              <ul className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                {message.comments.length ? message.comments.map((comment) => (
                    <li key={comment.id} className="flex gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-xs font-black text-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {comment.authorAvatarUrl ? <img src={publicImageVariantUrl(comment.authorAvatarUrl, 'avatar-md') || comment.authorAvatarUrl} alt={comment.authorName} className="h-full w-full object-cover" loading="lazy" /> : (comment.authorName || 'E').slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black text-brand-950">{comment.authorName}</span>
                        <time className="text-[11px] font-bold text-slate-400">{new Date(comment.createdAt).toLocaleString('zh-CN')}</time>
                        <IpRegionLabel ipRegion={comment.ipRegion} />
                      </div>
                      <p className="mt-0.5 break-words text-sm font-bold leading-5 text-slate-600">{comment.content}</p>
                    </div>
                  </li>
                )) : (
                  <li className="text-xs font-bold text-slate-400">暂无可见回复</li>
                )}
              </ul>
            ) : null}
          </article>
          )
        })}
        {pageNavigation}
      </div>
    )
  }

  if (moduleKey === 'salon') {
    const salonPosts = items as SalonPostView[]
    return (
      <div className="space-y-3">
        {salonPosts.map((post) => {
          const media = post.media[0]
          const context = formatSalonPostContext(post.category, post.concert)
          return <article key={post.id} className="min-w-0 overflow-hidden rounded-none border border-[var(--border)] bg-[var(--surface-subtle)] sm:flex">
            {media ? <Link href={`/salon/${post.id}`} className="block shrink-0 sm:w-40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={media.thumbnailUrl} alt={post.title || context} className="h-40 w-full object-cover sm:h-full" loading="lazy" />
            </Link> : null}
            <div className="min-w-0 flex-1 p-3 sm:p-4">
              <Link href={`/salon/${post.id}`} className="block min-w-0">
                <p className="text-xs font-black text-brand-700">{context}</p>
                <h3 className="mt-1 break-words text-base font-black text-brand-950">{post.title || (post.concert?.title || '沙龙作品')}</h3>
                <time className="mt-2 block text-xs font-bold text-slate-500">{new Date(post.createdAt).toLocaleString('zh-CN')}</time>
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
                <SalonLikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={post.likeCount} />
                <span className="inline-flex items-center gap-1"><UiIcon name="eye" className="size-3.5" />{post.viewCount}</span>
                <span>评论 {post.commentCount}</span>
              </div>
            </div>
          </article>
        })}
        {pageNavigation}
      </div>
    )
  }

  if (moduleKey === 'achievements') {
    const achievements = items as AchievementItem[]
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {achievements.map((item) => (
          <div key={item.id} className="border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
            <p className="text-3xl">{item.achievement.icon || '🏆'}</p>
            <h3 className="mt-2 font-black text-brand-950">{item.achievement.title}</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">{item.achievement.rarity}</p>
          </div>
        ))}
      </div>
    )
  }

  if (moduleKey === 'badges') {
    return <BadgeCollectionPanel uid={uid} isSelf={isSelf} />
  }

  if (moduleKey === 'albums') {
    const albums = items as AlbumItem[]
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {albums.map((item) => (
          <Link key={item.id} href={`/culture/${item.album.slug}`} className="rounded-none border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
            <p className="font-black text-brand-950">{item.album.title}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">{item.note || '已加入收藏馆'}</p>
          </Link>
        ))}
      </div>
    )
  }

  const favorites = items as FavoriteItem[]
  return (
    <div className="space-y-3">
      {favorites.map((item) => {
        const author = item.post.author
        const authorName = author.nickname || 'E院用户'
        return (
<Link
  key={item.id}
  href={`/posts/${item.post.id}`}
  className="block border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
>            <h3 className="text-lg font-black text-brand-950">{item.post.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.post.content}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">作者 <UserDisplayName name={authorName} uid={author.uid} badges={author.equippedBadges} badge={author.equippedBadge} compact /> · UID {formatUid(author.uid)}</p>
          </Link>
        )
      })}
    </div>
  )
}
