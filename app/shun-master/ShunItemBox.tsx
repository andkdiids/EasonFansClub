'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './shun.module.css'

const icons: Record<string, string> = {
  EXTRA_ATTEMPT: 'M4 12h16m-6-6 6 6-6 6M4 7v10',
  FRIEND_GIFT: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12m0-12C3 9 6 2 9 5l3 4c9 0 6-7 3-4z',
  EXTRA_SUSPECT: 'M12 3v18M3 12h18M6 6l12 12M6 18 18 6m-6 1a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  REVENGE: 'M20 5v7h-7m7 0-4-4a7 7 0 1 0 2 8',
  TARGET_FRIEND: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 5v4m-2-2h4',
  DOUBLE_AMOUNT: 'M3 6h18v12H3zM3 10h18m-13 5h3m3 0h2',
  RETRY_CAPTURE: 'M5 9a8 8 0 1 1 1 9M4 4v6h6m2-3v5l4 2',
}

const events: Record<string, string> = {
  DAILY_MAIN: '每日主线', COMMUNITY_DROP: '意外收获', WEEKLY_REWARD: '每周奖励',
  GIFT_RECEIVED: '收到礼物', GIFT_SENT: '送出礼物', USED: '使用', RESERVED: '待生效', RELEASED: '恢复可用',
}

export type ShunBoxData = { enabled: false } | {
  enabled: true
  total: number
  items: { code: string; name: string; description: string; icon: string; rarity: string; enabled: boolean; available: number; pending: number }[]
  history: { id: string; code: string; type: string; createdAt: string }[]
}

type Friend = { id: string; displayName: string }

export function ShunItemBox({ box, open, onClose, busy, errorMessage, onUse, onTarget }: {
  box: Extract<ShunBoxData, { enabled: true }>
  open: boolean
  onClose: () => void
  busy: boolean
  errorMessage: string
  onUse: (action: string, fields?: Record<string, unknown>) => Promise<void>
  onTarget: (friendId: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selecting, setSelecting] = useState<'gift' | 'target'>()
  const [friends, setFriends] = useState<Friend[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])

  async function selectFriend(mode: 'gift' | 'target') {
    setSelecting(mode)
    setError('')
    try {
      const response = await fetch('/api/friends/list?directory=1', { cache: 'no-store' })
      if (!response.ok) throw new Error()
      const data: { friends: Friend[] } = await response.json()
      setFriends(data.friends)
    } catch {
      setError('无法加载通讯录，请重试。')
    }
  }

  return <dialog ref={dialog} className={styles.itemBox} aria-labelledby="shun-item-title" onCancel={(event) => {
    event.preventDefault()
    onClose()
  }}>
    <div className={styles.itemBoxHeader}>
      <h2 id="shun-item-title">百宝箱 · {box.total}</h2>
      <button type="button" onClick={onClose}>关闭</button>
    </div>
    {errorMessage && <p role="alert">{errorMessage}</p>}
    <ul className={styles.itemGrid} aria-label="道具图鉴">
      {box.items.map((item) => <li key={item.code}>
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={icons[item.icon] ?? icons[item.code]} />
        </svg>
        <h3>{item.name} <small>{item.rarity}</small></h3>
        <p>{item.description}</p>
        <p>持有 {item.available + item.pending}{item.pending ? ' · 待生效' : ''}{item.enabled ? '' : ' · 已停用'}</p>
        {item.code === 'EXTRA_ATTEMPT' && <button type="button" disabled={busy || !item.available || !item.enabled} onClick={() => void onUse('extra-attempt')}>使用</button>}
        {['DOUBLE_AMOUNT', 'EXTRA_SUSPECT'].includes(item.code) && <button type="button" disabled={busy || (!item.pending && (!item.available || !item.enabled))}
          onClick={() => void onUse('pending-item', { code: item.code, cancel: item.pending > 0 })}>{item.pending ? '取消待生效' : '设为待生效'}</button>}
        {item.code === 'FRIEND_GIFT' && <button type="button" disabled={busy || !item.available || !item.enabled} onClick={() => void selectFriend('gift')}>赠送好友</button>}
        {item.code === 'TARGET_FRIEND' && <button type="button" disabled={busy || !item.available || !item.enabled} onClick={() => void selectFriend('target')}>选择好友</button>}
        {['RETRY_CAPTURE', 'REVENGE'].includes(item.code) && <small>在符合条件的历史记录中使用</small>}
      </li>)}
    </ul>
    {selecting && <section aria-label="通讯录好友">
      <h3>通讯录好友</h3>
      <button type="button" onClick={() => setSelecting(undefined)}>返回道具</button>
      {error && <p role="alert">{error}</p>}
      {friends?.length === 0 && <p>通讯录暂无好友。</p>}
      <ul className={styles.itemFriends}>{friends?.map((friend) => <li key={friend.id}>
        <button type="button" disabled={busy} onClick={() => {
          setSelecting(undefined)
          if (selecting === 'target') onTarget(friend.id)
          else void onUse('gift', { friendId: friend.id })
        }}>{friend.displayName}</button>
      </li>)}</ul>
    </section>}
    <h3>获取、使用及赠送记录</h3>
    {box.history.length ? <ol className={styles.itemHistory}>{box.history.map((entry) => <li key={entry.id}>
      <span>{events[entry.type]} · {box.items.find((item) => item.code === entry.code)?.name ?? entry.code}</span>
      <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time>
    </li>)}</ol> : <p>暂无道具记录。</p>}
  </dialog>
}
