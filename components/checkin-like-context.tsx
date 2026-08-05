'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type CheckInLikeValue = { liked: boolean; likeCount: number }

type CheckInLikeContextValue = {
  getLike: (id: string) => CheckInLikeValue | undefined
  setLike: (id: string, value: CheckInLikeValue) => void
  /** 服务端重新加载留言后调用：以服务端返回的 likeCount / liked 刷新既有覆盖层，避免旧缓存覆盖新数据。 */
  reconcileLikes: (items: Array<{ id: string; likeCount: number; liked: boolean }>) => void
}

const CheckInLikeContext = createContext<CheckInLikeContextValue | null>(null)

/**
 * 每日挂号页面的「E友留言」与「好友留言」是两个并列的 CheckInMessagesPanel 实例，
 * 但它们可能展示同一条留言（好友的留言同时出现在两个区域）。为让一侧点赞后另一侧
 * 实时同步、且翻页导致组件卸载重挂后不丢失点赞状态，这里维护一个跨面板的覆盖层：
 * 以 messageId 为键记录「点赞后的最新 liked / likeCount」，优先于服务端初始值使用。
 *
 * 重要：覆盖层只作为「即时同步状态」——在用户点赞动作到下一次服务端重载之间提供
 * 跨面板 / 翻页的即时反馈。一旦服务端重新加载留言，必须调用 reconcileLikes 用服务端
 * 返回的 likeCount / liked 刷新覆盖层，确保服务端最新数据成为权威源，旧缓存不会覆盖新数据。
 */
export function CheckInLikeProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, CheckInLikeValue>>({})

  const getLike = useCallback((id: string) => overrides[id], [overrides])
  const setLike = useCallback((id: string, value: CheckInLikeValue) => {
    setOverrides((current) => ({ ...current, [id]: value }))
  }, [])
  const reconcileLikes = useCallback((items: Array<{ id: string; likeCount: number; liked: boolean }>) => {
    setOverrides((current) => {
      let changed = false
      const next: Record<string, CheckInLikeValue> = { ...current }
      for (const item of items) {
        const existing = next[item.id]
        if (!existing) continue
        if (existing.liked !== item.liked || existing.likeCount !== item.likeCount) {
          next[item.id] = { liked: item.liked, likeCount: item.likeCount }
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [])

  const value = useMemo<CheckInLikeContextValue>(
    () => ({ getLike, setLike, reconcileLikes }),
    [getLike, setLike, reconcileLikes],
  )

  return <CheckInLikeContext.Provider value={value}>{children}</CheckInLikeContext.Provider>
}

/**
 * 无 Provider 时降级为本地独立状态（setLike / reconcileLikes 为 no-op），不影响其它使用点。
 */
export function useCheckInLike(): CheckInLikeContextValue {
  const ctx = useContext(CheckInLikeContext)
  if (ctx) return ctx
  return { getLike: () => undefined, setLike: () => {}, reconcileLikes: () => {} }
}
