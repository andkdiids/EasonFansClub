'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { publicImageUrl } from '@/lib/images'
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

const rarityClass: Record<string, string> = {
  普通: styles.rarityCommon, 稀有: styles.rarityRare, 珍藏: styles.rarityPrecious, 隐藏: styles.rarityHidden,
}

/** 用户可见文案：内部枚举不变，历史数据不重写。 */
const sourceLabels: Record<string, string> = {
  DAILY_MAIN: '今天只做一件事',
  COMMUNITY_DROP: '社区互动',
  WEEKLY_REWARD: '每周活跃奖励',
  GIFT_RECEIVED: '收到好友赠礼',
  GIFT_REWARD: '赠礼回礼',
  ADMIN_GRANT: 'E院赠礼',
  GIFT_SENT: '赠送好友礼物',
  USED: '使用道具',
  RESERVED: '设为待生效',
  RELEASED: '恢复可用',
}

const dropLabels: Record<string, string> = {
  CHECK_IN: '每日挂号', PRESCRIPTION: '领取处方', COMMENT: '有效评论', SHARE: '分享帖子', LIKE: '点赞帖子',
}

export type GiftDelivery = {
  id: string
  name: string
  rewardName?: string | null
  receiver: { nickname: string; avatarUrl: string | null } | null
}

export type ShunItem = {
  code: string; name: string; description: string; icon: string; rarity: string
  enabled: boolean; available: number; pending: number
}

export type ShunGuide = {
  dailyMain: boolean
  weekly: Record<string, boolean>
  community: boolean
  dailyMax: number
  drops: Record<string, { chance: number; dailyChecks: number }>
  giftsReceived: number
  extraAttempts: number
  commentMinChars: number
  giftEnabled: boolean
  giftPool: { code: string; name: string; weight: number }[]
}

export type ShunBoxData = { enabled: false } | {
  enabled: true
  total: number
  items: ShunItem[]
  history: { id: string; code: string; type: string; createdAt: string }[]
  guide: ShunGuide
}

type HistoryGift = {
  direction: 'sent' | 'received'
  counterpart: { uid: number; nickname: string; avatarUrl: string | null } | null
  sentCode: string; sentName: string
  receivedCode: string; receivedName: string
  rewardCode: string | null; rewardName: string | null
  legacy: boolean
}

type HistoryRecord = {
  id: string; type: string; code: string; name: string; sourceLabel: string | null
  grantReason?: string | null
  amount: number; pendingDelta: number; createdAt: string
  gift: HistoryGift | null
}

type Friend = { id: string; displayName: string; available: boolean }
type Filter = 'all' | 'acquired' | 'used' | 'gift'

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'acquired', label: '获取' },
  { key: 'used', label: '使用' }, { key: 'gift', label: '赠送' },
]

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

export function ShunItemBox({ box, open, onClose, busy, errorMessage, gifting, delivery, onUse, onTarget }: {
  box: Extract<ShunBoxData, { enabled: true }>
  open: boolean
  onClose: () => void
  busy: boolean
  errorMessage: string
  gifting: boolean
  delivery?: GiftDelivery
  onUse: (action: string, fields?: Record<string, unknown>) => Promise<void>
  onTarget: (friendId: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<'items' | 'guide' | 'history'>('items')
  const [detail, setDetail] = useState<string>()
  const [giftConfirm, setGiftConfirm] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [friends, setFriends] = useState<Friend[]>()
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyMore, setHistoryMore] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const receiverAvatar = publicImageUrl(delivery?.receiver?.avatarUrl)

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])

  // 弹窗打开时冻结背景滚动：H5 与微信内置浏览器都不会跟着滚。
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  const detailItem = useMemo(() => box.items.find((item) => item.code === detail), [box.items, detail])

  const loadHistory = useCallback(async (next: Filter, cursor?: string) => {
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const query = new URLSearchParams({ filter: next, limit: '20' })
      if (cursor) query.set('cursor', cursor)
      const response = await fetch('/api/shun-master/item-history?' + query, { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '记录加载失败。')
      setHistory((previous) => cursor ? [...previous, ...(data.records || [])] : (data.records || []))
      setHistoryCursor(data.nextCursor || null)
      setHistoryMore(!!data.hasMore)
      setHistoryLoaded(true)
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : '记录加载失败。')
    } finally {
      setHistoryBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!open || tab !== 'history') return
    void loadHistory(filter)
  }, [open, tab, filter, loadHistory])

  // 赠礼成功后刷新当前分类，关闭重开仍能看到这次记录。
  useEffect(() => {
    if (!delivery || !open || tab !== 'history') return
    void loadHistory(filter)
  }, [delivery, open, tab, filter, loadHistory])

  async function selectFriend() {
    setSelecting(true)
    setFriends(undefined)
    setError('')
    try {
      const [directory, eligibility] = await Promise.all([
        fetch('/api/friends/list?directory=1', { cache: 'no-store' }),
        fetch('/api/shun-master/target-friends', { cache: 'no-store' }),
      ])
      if (!directory.ok || !eligibility.ok) throw new Error()
      const data: { friends: Omit<Friend, 'available'>[] } = await directory.json()
      const { eligibleIds }: { eligibleIds: string[] } = await eligibility.json()
      const eligible = new Set(eligibleIds)
      setFriends(data.friends.map((friend) => ({ ...friend, available: eligible.has(friend.id) })))
    } catch {
      setError('无法加载通讯录，请重试。')
    }
  }

  function itemAction(item: ShunItem) {
    if (item.code === 'EXTRA_ATTEMPT') {
      return <button type="button" disabled={busy || !item.available || !item.enabled} onClick={() => void onUse('extra-attempt')}>使用</button>
    }
    if (item.code === 'FRIEND_GIFT') {
      return <button type="button" disabled={busy || !item.available || !item.enabled} onClick={() => setGiftConfirm(true)}>随机赠送</button>
    }
    if (item.code === 'TARGET_FRIEND') {
      return <button type="button" disabled={busy || !item.available || !item.enabled} onClick={() => void selectFriend()}>选择好友</button>
    }
    if (['DOUBLE_AMOUNT', 'EXTRA_SUSPECT'].includes(item.code)) {
      return <button type="button" disabled={busy || (!item.pending && (!item.available || !item.enabled))}
        onClick={() => void onUse('pending-item', { code: item.code, cancel: item.pending > 0 })}>
        {item.pending ? '取消待生效' : '设为待生效'}
      </button>
    }
    return <small className={styles.itemHint}>在符合条件的历史记录中使用</small>
  }

  const guide = box.guide
  const guideRows: { key: string; text: string; note: string }[] = [
    ...(guide.dailyMain ? [{ key: 'main', text: '今天只做一件事', note: '完成全部每日任务，必得 1 个道具' }] : []),
    ...(['CHECK_IN', 'PRESCRIPTION', 'COMMENT', 'SHARE', 'LIKE'] as const)
      .filter((code) => guide.community && guide.drops[code])
      .map((code) => ({
        key: code as string,
        text: dropLabels[code],
        note: `${guide.drops[code].chance}% 概率，每日 ${guide.drops[code].dailyChecks} 次有效判定`,
      })),
    ...([3, 5, 7] as const).filter((milestone) => guide.weekly[String(milestone)])
      .map((milestone) => ({ key: `w${milestone}`, text: `每周累计完成 ${milestone} 天`, note: '必得 1 个道具' })),
    ...(guide.giftEnabled ? [{ key: 'gift-in', text: '好友赠礼', note: `每日最多收到 ${guide.giftsReceived} 次` }] : []),
    ...(guide.giftEnabled ? [{
      key: 'gift-out',
      text: '使用天使的礼物',
      note: `成功赠送好友后，自己也获得 1 个随机道具${
        guide.giftPool.length ? '（' + guide.giftPool.map((entry) => `${entry.name} ${entry.weight}%`).join(' / ') + '）' : ''}`,
    }] : []),
  ]

  // 关闭态只保留 <dialog> 骨架，内容整体不挂载：既保证不可见、不可交互，
  // 也不会出现第二个实例或上一次的残留结果。
  return <dialog ref={dialog} className={styles.itemBox} aria-labelledby="shun-item-title" onCancel={(event) => {
    event.preventDefault()
    onClose()
  }}>
    {!open ? null : <>
    <div className={styles.itemBoxHeader}>
      <h2 id="shun-item-title">百宝箱 · {box.total}</h2>
      <button type="button" onClick={onClose}>关闭</button>
    </div>
    <div className={styles.itemTabs} role="tablist" aria-label="百宝箱分页">
      {([['items', '我的道具'], ['guide', '获取方式'], ['history', '历史记录']] as const).map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key}
          className={tab === key ? styles.itemTabActive : undefined}
          onClick={() => { setTab(key); setDetail(undefined) }}>
          {label}
        </button>
      ))}
    </div>
    <div className={styles.itemBody}>
      {(errorMessage || error) && <p role="alert">{errorMessage || error}</p>}
      {tab === 'items' && <>
        <ul className={styles.itemGrid} aria-label="道具图鉴">
          {box.items.map((item) => <li key={item.code}>
            <button type="button" className={styles.itemCard} aria-label={`${item.name} 详情`} onClick={() => setDetail(item.code)}>
              <span className={`${styles.itemIcon} ${rarityClass[item.rarity] ?? ''}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icons[item.icon] ?? icons[item.code]} />
                </svg>
              </span>
              <span className={styles.itemTitle}>
                <strong>{item.name}</strong>
                <em className={rarityClass[item.rarity]}>{item.rarity}</em>
              </span>
              <span className={styles.itemCount}>×{item.available + item.pending}</span>
              <span className={styles.itemDesc}>{item.description}</span>
              {item.pending > 0 && <span className={styles.itemBadge}>待生效</span>}
            </button>
          </li>)}
        </ul>
        <p className={styles.itemFootnote}>点击卡片查看完整说明与使用入口；没有道具时图鉴也会完整展示。</p>
      </>}
      {tab === 'guide' && <section className={styles.itemGuide} aria-label="道具获取方式">
        <ol>
          {guideRows.map((row) => <li key={row.key}>
            <strong>{row.text}</strong>
            <span>{row.note}</span>
          </li>)}
        </ol>
      </section>}
      {tab === 'history' && <section aria-label="道具历史记录">
        <div className={styles.itemFilters}>
          {filters.map((entry) => <button key={entry.key} type="button"
            className={filter === entry.key ? styles.itemTabActive : undefined}
            onClick={() => { setFilter(entry.key); setHistory([]); setHistoryLoaded(false) }}>
            {entry.label}
          </button>)}
        </div>
        {historyError && <p role="alert">{historyError}</p>}
        {!historyLoaded && historyBusy && <p role="status">正在加载记录…</p>}
        {historyLoaded && !history.length && !historyBusy && <p className={styles.itemFootnote}>暂无道具记录。</p>}
        {!!history.length && <ol className={styles.itemHistory}>
          {history.map((record) => <li key={record.id}>
            {record.gift ? <>
              <span className={styles.itemHistoryTitle}>
                {record.gift.direction === 'sent' ? '天使的礼物 · 赠送成功' : '收到好友赠礼'}
                {record.gift.counterpart
                  ? ` · ${record.gift.direction === 'sent' ? '赠送给' : '来自'} ${record.gift.counterpart.nickname}`
                  : ''}
              </span>
              <span className={styles.itemHistoryDetail}>
                {record.gift.direction === 'sent' ? <>
                  <span>送出：{record.gift.receivedName} ×1</span>
                  {record.gift.legacy ? null : <span>回礼：{record.gift.rewardName} ×1</span>}
                  <span>消耗：天使的礼物 ×1</span>
                </> : <span>获得：{record.gift.receivedName} ×1</span>}
              </span>
            </> : <span>
              {sourceLabels[record.type] ?? record.type}
              {record.sourceLabel ? ` · ${record.sourceLabel}` : ''}
              {' · '}{record.name}
              {record.amount ? `（${record.amount > 0 ? '+' : ''}${record.amount}）` : ''}
            </span>}
            {record.type === 'ADMIN_GRANT' && record.grantReason && <span className={styles.itemHistoryDetail}>
              <span>发放原因：{record.grantReason}</span>
            </span>}
            <time dateTime={record.createdAt}>{formatTime(record.createdAt)}</time>
          </li>)}
        </ol>}
        {historyMore && <button type="button" className={styles.itemMore} disabled={historyBusy}
          onClick={() => { if (historyCursor) void loadHistory(filter, historyCursor) }}>加载更多</button>}
      </section>}
    </div>
    {detailItem && <section className={styles.itemDetail} aria-label={detailItem.name}>
      <div className={styles.itemDetailHead}>
        <span className={`${styles.itemIcon} ${rarityClass[detailItem.rarity] ?? ''}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d={icons[detailItem.icon] ?? icons[detailItem.code]} />
          </svg>
        </span>
        <h3>{detailItem.name} <em className={rarityClass[detailItem.rarity]}>{detailItem.rarity}</em></h3>
        <span className={styles.itemCount}>×{detailItem.available + detailItem.pending}</span>
      </div>
      <p>{detailItem.description}</p>
      {detailItem.code === 'FRIEND_GIFT' && <p className={styles.itemFootnote}>
        使用后系统随机选择一位符合条件的通讯录好友，为 TA 送出一个随机道具，同时你也获得一个随机道具。
        每位用户每日最多收到一次好友赠礼。
      </p>}
      {!detailItem.enabled && <p className={styles.itemFootnote}>该道具暂未开放。</p>}
      <div className={styles.itemDetailActions}>
        {itemAction(detailItem)}
        <button type="button" onClick={() => setDetail(undefined)}>返回</button>
      </div>
    </section>}
    {giftConfirm && <section className={styles.itemConfirm} role="dialog" aria-label="确认赠送">
      <h3>送出一份礼物，也为自己收获一份惊喜。</h3>
      <p className={styles.itemFootnote}>系统会随机选择一位符合条件的通讯录好友，你也会收到一份随机回礼。</p>
      <div className={styles.itemDetailActions}>
        <button type="button" disabled={busy} onClick={() => { setGiftConfirm(false); void onUse('gift') }}>确认赠送</button>
        <button type="button" onClick={() => setGiftConfirm(false)}>再想想</button>
      </div>
    </section>}
    {gifting && <p role="status" className={styles.itemFootnote}>正在送出这份惊喜…</p>}
    {!gifting && delivery && <section className={styles.giftDelivery} role="status">
      <h3>礼物已送达！</h3>
      <p className={styles.giftReceiver}>
        {receiverAvatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={receiverAvatar} alt="" width={32} height={32} />
        )}
        <span>{delivery.receiver?.nickname ?? 'EF'}</span>
      </p>
      <div className={styles.giftPair}>
        <div>
          <small>TA 收到了</small>
          <strong>{delivery.name} ×1</strong>
        </div>
        {delivery.rewardName && <div>
          <small>你也收到了</small>
          <strong>{delivery.rewardName} ×1</strong>
        </div>}
      </div>
      <p className={styles.itemFootnote}>送出一份惊喜，也收获一份幸运。</p>
    </section>}
    {selecting && <section className={styles.itemSheet} aria-label="通讯录好友">
      <h3>通讯录好友</h3>
      <button type="button" onClick={() => setSelecting(false)}>返回</button>
      {friends?.length === 0 && <p>通讯录暂无好友。</p>}
      <ul className={styles.itemFriends}>{friends?.map((friend) => <li key={friend.id}>
        <button type="button" disabled={busy || !friend.available} onClick={() => {
          setSelecting(false)
          onTarget(friend.id)
        }}>{friend.displayName}{friend.available ? '' : ' · 暂不可顺取'}</button>
      </li>)}</ul>
    </section>}
    </>}
  </dialog>
}
