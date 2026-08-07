'use client'

import { useEffect } from 'react'

/**
 * 进入"审核中心"（帖子详情页 / 我的表情包页）时，挂载即调用一次
 * POST /api/notifications/mark-moderation-read，把当前用户所有已完成审核结果
 * 的通知批量标记为已读，解决"点开一条审核通知后，其余审核通知仍残留未读"的问题。
 *
 * - 幂等：接口仅更新未读行，重复进入页面安全。
 * - 只清理审核结果通知（type=ADMIN 且 link 为 /posts/* 或 /profile/stickers），
 *   不影响点赞/评论/私信/公告等其他通知。
 * - 仅当本次确实清理了 >0 条时才派发 unread-summary:refresh，触发通知中心
 *   未读数刷新；清理失败静默忽略，绝不阻塞页面加载。
 */
export function MarkModerationReadOnMount() {
  useEffect(() => {
    let cancelled = false

    fetch('/api/notifications/mark-moderation-read', { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) return null
        try {
          return await res.json()
        } catch {
          return null
        }
      })
      .then((data) => {
        if (cancelled || !data || typeof data.count !== 'number') return
        if (data.count > 0) {
          window.dispatchEvent(new Event('unread-summary:refresh'))
        }
      })
      .catch(() => {
        // best-effort，忽略网络/服务端错误
      })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
