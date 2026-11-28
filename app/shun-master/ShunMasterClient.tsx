'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { comboEffectLines } from '@/lib/shun-combo'
import { ShunMasterArt } from '@/components/ShunMasterArt'
import { ShunMasterLogo } from '@/components/ShunMasterLogo'
import { AnonymousLetter, type AnonymousLetterData } from '@/components/shun-master/AnonymousLetter'
import { CaptureLetter, type CaptureLetterData } from '@/components/shun-master/CaptureLetter'
import { SendAnonymousLetter } from '@/components/shun-master/SendAnonymousLetter'
import { publicImageUrl } from '@/lib/images'
// Pure, browser-safe: the same helpers the settlement gate uses, so the closed
// state flips at exactly the boundary the server enforces.
import { SHUN_CLOSED_TITLE, isShunOpen, shunOpenHoursHelp, shunOpenHoursHint, shunOpenHoursLine } from '@/lib/shun-open-hours'
import { formatUid } from '@/lib/uid'
import { ShunItemBox, type GiftDelivery, type ShunBoxData } from './ShunItemBox'
import styles from './shun.module.css'

const MESSAGE_MAX = 60

type Person = { uid: number; nickname: string; avatarUrl: string | null }
type Round = { id: string; amount: number; recovered: number; result: 'SUCCESS' | 'FAILED' | null
  createdAt: string; goldenUntil: string; person: Person | null; canCapture: boolean; hasLetter?: boolean
  /** Platform bonus granted on a successful capture (0 when the roll lost). */
  bonusAwarded?: number
  /** Capturer side: this capture already carries a delivered counter note. */
  hasCaptureLetter?: boolean; itemOutcomes?: { code: string; amount: number }[]; usedItems?: { code: string; name: string }[] }
type OpenHours = { openHoursEnabled: boolean; openTime: string; closeTime: string; label: string; open: boolean; nextOpenAt: string | null }
type Status = { enabled: boolean; optedOut: boolean; balance: number; remaining: number; received: number; attempts: number; victimCap: number; goldenMinutes: number
  targetFriendVictimCap?: number; totalVictimCap?: number
  /** V6: the daily window exactly as the server judged it for `serverNow`. */
  openHours?: OpenHours
  serverNow: string }
type Records = { records: Round[]; focused: Round | null; nextCursor: string | null; windowAt: string }
type Capture = { mode: number; golden?: boolean; candidates: Person[]; serverNow: string; goldenUntil: string }
type Side = 'in' | 'out'

class RequestError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message) }
}

async function api<T>(path: string, body?: object, method?: 'POST'): Promise<T> {
  const response = await fetch('/api/shun-master/' + path, {
    cache: 'no-store', ...(body || method
      ? { method: method || 'POST', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }
      : {}),
  }).catch(() => { throw new RequestError('网络连接中断，请重试。') })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new RequestError(data?.message || '请求失败，请重试。', data?.code, response.status)
  return data
}

function PersonLabel({ person, link = false }: { person: Person | null; link?: boolean }) {
  const avatar = publicImageUrl(person?.avatarUrl)
  const content = <>{avatar && (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatar} alt="" width={28} height={28} />
  )}<span>{person?.nickname || '神秘 EF'}</span></>
  return person && link
    ? <Link className={styles.person} href={`/user/${formatUid(person.uid)}`}>{content}</Link>
    : <span className={styles.person}>{content}</span>
}

export function ShunMasterClient({ focusedRecord, initialSide, initialGuest, autoLetterId, autoCaptureLetterId, initialItemsOpen = false, sessionUserId }: {
  focusedRecord?: string; sessionUserId?: string; initialItemsOpen?: boolean; initialSide: Side; initialGuest: boolean; autoLetterId?: string
  /** V5:一-shot flag from a capture notice that carries a counter note. */
  autoCaptureLetterId?: string
}) {
  const [status, setStatus] = useState<Status>()
  const [box, setBox] = useState<ShunBoxData>()
  const [boxOpen, setBoxOpen] = useState(initialItemsOpen)
  const [newItems, setNewItems] = useState(false)
  const [boxError, setBoxError] = useState('')
  const [delivery, setDelivery] = useState<GiftDelivery>()
  const boxRequests = useRef(new Map<string, string>())
  const targetRequest = useRef<string | undefined>(undefined)
  const attemptItems = useRef<string[] | undefined>(undefined)
  const [side, setSide] = useState<Side>(initialSide)
  const [range, setRange] = useState('all')
  const [dateKey, setDateKey] = useState('')
  const [list, setList] = useState<Records>()
  const [result, setResult] = useState<Round>()
  const [capture, setCapture] = useState<{ id: string; data: Capture }>()
  const [caught, setCaught] = useState<Round>()
  const [selected, setSelected] = useState<number>()
  const [now, setNow] = useState<number>()
  const [clockOffset, setClockOffset] = useState(0)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState(initialGuest)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [recordError, setRecordError] = useState('')
  // The take is settled first; the letter is a separate, later decision.
  const [step, setStep] = useState<'result' | 'write' | 'sending' | 'animate' | 'delivered' | 'expired'>('result')
  const [notice, setNotice] = useState('')
  const [message, setMessage] = useState('')
  const [letter, setLetter] = useState<AnonymousLetterData>()
  const [letterBusy, setLetterBusy] = useState(false)
  const [letterError, setLetterError] = useState('')
  // Re-opening a letter from the record list skips the delivery animation.
  const [letterInstant, setLetterInstant] = useState(false)
  // Capture counter note reading view (the caught actor's side).
  const [captureLetterView, setCaptureLetterView] = useState<CaptureLetterData>()
  const [captureLetterBusy, setCaptureLetterBusy] = useState(false)
  const [captureLetterError, setCaptureLetterError] = useState('')
  // Capture counter note: the result is settled first, the note is a separate,
  // later decision that reuses the very same delivery animation.
  const [captureStep, setCaptureStep] = useState<'result' | 'write' | 'sending' | 'animate' | 'delivered' | 'expired'>('result')
  const [captureMessage, setCaptureMessage] = useState('')
  // Permanent opt-out confirmation. Kept local and unchecked by default; the
  // exit entry only ever renders inside the collapsed-by-default rules block.
  const [optOutOpen, setOptOutOpen] = useState(false)
  const [optOutAck, setOptOutAck] = useState(false)
  // Visible landing spot after an overlay closes: the capture picker, the
  // settlement panel or one record row. Without it the state changes but the
  // user sees nothing, which was the reported "no feedback" bug.
  const [pendingFocus, setPendingFocus] = useState<string[] | null>(null)
  const lock = useRef(false)
  const slowNotice = useRef<number | undefined>(undefined)
  const slowNotice2 = useRef<number | undefined>(undefined)
  const requestId = useRef<string | null>(null)
  const sequence = useRef(0)
  const dialog = useRef<HTMLDialogElement>(null)
  // One notification click may only open one envelope: guards against React
  // re-renders and StrictMode double effects replaying the animation.
  const letterRequested = useRef(false)
  // One notification click may only open one counter note.
  const captureLetterRequested = useRef(false)
  // A notification deep link must land on its record once, not on every render.
  const focusOnce = useRef(false)
  const loadItems = useCallback(async () => {
    try {
      const data = await api<ShunBoxData>('items')
      setBox(data)
      if (data.enabled) {
        const acquisition = data.history.find((entry) => ['DAILY_MAIN', 'COMMUNITY_DROP', 'WEEKLY_REWARD', 'GIFT_RECEIVED'].includes(entry.type))
        try { setNewItems(!!acquisition && sessionStorage.getItem('ecfc-shun-last-viewed-item') !== acquisition.id) }
        catch { setNewItems(false) }
      }
    } catch {
      // A box refresh is independent of fee settlement and the letter flow.
    }
  }, [])
  useEffect(() => {
    const refresh = () => void loadItems()
    window.addEventListener('shun-item-acquired', refresh)
    return () => window.removeEventListener('shun-item-acquired', refresh)
  }, [loadItems])
  useEffect(() => {
    if (!boxOpen || !box?.enabled) return
    const entry = box.history.find((row) => ['DAILY_MAIN', 'COMMUNITY_DROP', 'WEEKLY_REWARD', 'GIFT_RECEIVED'].includes(row.type))
    if (entry) {
      try { sessionStorage.setItem('ecfc-shun-last-viewed-item', entry.id) } catch { /* optional session storage */ }
    }
    setNewItems(false)
  }, [box, boxOpen])

  const loadStatus = useCallback(async () => {
    try {
      const response = await api<Status>('status')
      setStatus(response)
      setClockOffset(Date.parse(response.serverNow) - Date.now())
      setGuest(false)
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) { setGuest(true); return }
      setError(error instanceof Error ? error.message : '状态加载失败。')
    }
  }, [])
  const loadRecords = useCallback(async (cursor?: string, windowAt?: string) => {
    const version = ++sequence.current
    setLoading(true)
    setRecordError('')
    if (!cursor) setList(undefined)
    if (range === 'date' && !dateKey) { setLoading(false); return }
    const query = new URLSearchParams({ side, range })
    if (range === 'date') query.set('dateKey', dateKey)
    if (cursor) query.set('cursor', cursor)
    if (cursor && windowAt) query.set('windowAt', windowAt)
    if (focusedRecord && side === initialSide) query.set('record', focusedRecord)
    try {
      const next = await api<Records>('records?' + query)
      if (version === sequence.current) setList((previous) => !cursor ? next : {
        ...next, records: [...(previous?.records || []), ...next.records],
      })
    } catch (error) {
      if (version === sequence.current) setRecordError(error instanceof Error ? error.message : '记录加载失败。')
    } finally {
      if (version === sequence.current) setLoading(false)
    }
  }, [side, focusedRecord, initialSide, range, dateKey])
  useEffect(() => { if (!initialGuest) { void loadStatus(); void loadItems() } }, [initialGuest, loadStatus, loadItems])
  const signedIn = !!status
  useEffect(() => { if (signedIn) void loadRecords() }, [signedIn, loadRecords])
  // 「前往调查」从通知里带着 roundId 进来：记录加载完成后滚到对应那条，
  // 让点击一定落在看得见、可操作的目标上（未抓捕时同一行就有「抓捕追回」）。
  useEffect(() => {
    if (focusOnce.current || !focusedRecord || !list?.focused) return
    focusOnce.current = true
    setPendingFocus([`shun-record-${focusedRecord}`, 'shun-records'])
  }, [focusedRecord, list])
  const openLetter = useCallback(async (id: string, instant = false) => {
    setLetterInstant(instant)
    try {
      setLetter(await api<AnonymousLetterData>('letter/' + encodeURIComponent(id)))
      setLetterError('')
    } catch {
      // Missing, hidden, expired or foreign letters degrade silently: no empty
      // envelope and no error banner, the record list behaves as before.
      setLetter(undefined)
    }
  }, [])
  const openCaptureLetter = useCallback(async (id: string) => {
    try {
      setCaptureLetterView(await api<CaptureLetterData>('capture-letter/' + encodeURIComponent(id)))
      setCaptureLetterError('')
    } catch {
      // Missing, hidden or foreign notes degrade silently: no empty sheet and no
      // error banner, the record list behaves exactly as before.
      setCaptureLetterView(undefined)
    }
  }, [])
  useEffect(() => {
    if (!autoCaptureLetterId || !signedIn || captureLetterRequested.current) return
    captureLetterRequested.current = true
    const url = new URL(window.location.href)
    if (url.searchParams.has('captureLetter')) {
      url.searchParams.delete('captureLetter')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    void openCaptureLetter(autoCaptureLetterId)
  }, [autoCaptureLetterId, signedIn, openCaptureLetter])
  useEffect(() => {
    if (!autoLetterId || !signedIn || letterRequested.current) return
    letterRequested.current = true
    // Drop the one-shot flag from the address bar so a refresh, a back
    // navigation or a re-render can never replay the delivery animation.
    const url = new URL(window.location.href)
    if (url.searchParams.has('letter')) {
      url.searchParams.delete('letter')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    void openLetter(autoLetterId)
  }, [autoLetterId, signedIn, openLetter])
  useEffect(() => {
    const update = () => setNow(Date.now() + clockOffset)
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [clockOffset])
  /**
   * V6: the daily window must flip without a reload.
   *
   * The one-second tick is already corrected by the server clock offset, so the
   * boundary lands on the right second locally; the status request that follows
   * re-syncs the authoritative values (and picks up an admin change). The server
   * still re-checks the window inside the settlement transaction, so a wrong
   * client clock can only mislead the display, never authorise a take.
   */
  const openHours = status?.openHours
  const openNow = openHours ? isShunOpen(openHours, new Date(now ?? Date.now())) : true
  const openState = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (!openHours) return
    if (openState.current === undefined) { openState.current = openNow; return }
    if (openState.current === openNow) return
    openState.current = openNow
    void loadStatus()
  }, [openHours, openNow, loadStatus])
  // Returning to the tab must re-sync instead of trusting a page that may have
  // been asleep for hours (or a laptop that was suspended across the boundary).
  useEffect(() => {
    if (!status) return
    const resync = () => { if (document.visibilityState === 'visible') void loadStatus() }
    window.addEventListener('focus', resync)
    document.addEventListener('visibilitychange', resync)
    return () => {
      window.removeEventListener('focus', resync)
      document.removeEventListener('visibilitychange', resync)
    }
  }, [status, loadStatus])
  useEffect(() => {
    const modal = dialog.current
    const visible = !!result && step !== 'animate'
    if (visible && modal && !modal.open) modal.showModal()
    if (!visible && modal?.open) modal.close()
  }, [result, step])
  // Scrolls the first candidate target that exists, so a click that closes an
  // overlay always ends on something the user can see and act on.
  useEffect(() => {
    if (!pendingFocus?.length) return
    const node = pendingFocus
      .map((id) => document.getElementById(id))
      .find((element): element is HTMLElement => element !== null)
    if (!node) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    node.focus({ preventScroll: true })
    setPendingFocus(null)
  }, [pendingFocus, list, capture, caught, letter])

  async function perform(name: string, action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(name)
    setError('')
    try { await action() } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败，请重试。')
    } finally {
      lock.current = false
      setBusy('')
    }
  }
  async function confirmOptOut() {
    if (!optOutAck) return
    await perform('opt-out', async () => {
      const response = await api<{ optedOut: boolean }>('opt-out', undefined, 'POST')
      setOptOutOpen(false)
      setOptOutAck(false)
      setNotice('你已永久退出顺大师')
      await loadStatus()
      if (!response.optedOut) setError('退出未生效，请稍后重试。')
    })
  }
  const usableItem = (code: string) => box?.enabled && box.items.some((item) => item.code === code && item.enabled && item.available > 0)

  // V4.2.4 顺取前道具选择：三种攻击类道具可同时勾选，效果叠加。
  const ATTACK_ORDER = ['TARGET_FRIEND', 'DOUBLE_AMOUNT', 'EXTRA_SUSPECT'] as const
  type TargetFriend = { id: string; uid: number; nickname: string; displayName: string; remark: string | null; avatarUrl: string | null }
  const takeItems = box?.enabled ? box.items.filter((item) => (ATTACK_ORDER as readonly string[]).includes(item.code)
    && item.enabled && item.available > 0) : []
  const pendingAttack = box?.enabled ? box.items.filter((item) => (ATTACK_ORDER as readonly string[]).includes(item.code) && item.pending > 0) : []
  const [pickOpen, setPickOpen] = useState(false)
  const [pickMode, setPickMode] = useState<'choose' | 'items' | 'friends'>('choose')
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [pickFriends, setPickFriends] = useState<TargetFriend[]>()
  const [friendQuery, setFriendQuery] = useState('')
  const [friendCursor, setFriendCursor] = useState<string | null>(null)
  const [friendTotal, setFriendTotal] = useState(0)
  const [friendLoading, setFriendLoading] = useState(false)
  const [friendSelected, setFriendSelected] = useState<string>()
  const friendRequest = useRef(0)
  const [pickError, setPickError] = useState('')
  const [extraConfirm, setExtraConfirm] = useState(false)

  const previewLines = useMemo(() => comboEffectLines(selectedCodes.filter((code) =>
    (ATTACK_ORDER as readonly string[]).includes(code)) as Array<'TARGET_FRIEND' | 'DOUBLE_AMOUNT' | 'EXTRA_SUSPECT'>), [selectedCodes])
  const selectedName = (code: string) => (box?.enabled ? box.items.find((item) => item.code === code)?.name : undefined)
    ?? ({ TARGET_FRIEND: '任我顺', DOUBLE_AMOUNT: '碌卡', EXTRA_SUSPECT: '十面埋伏' } as Record<string, string>)[code] ?? code

  function startTake() {
    if (busy || !status?.remaining || !openNow) return
    setPickError('')
    setSelectedCodes(pendingAttack.map((item) => item.code))
    setFriendQuery('')
    setFriendCursor(null)
    setFriendTotal(0)
    setFriendSelected(undefined)
    setPickFriends(undefined)
    // 没有可用攻击道具（也没有待生效道具）时直接普通顺取，不弹选择窗。
    if (!takeItems.length && !pendingAttack.length) { void attempt(undefined, []); return }
    setPickMode('choose')
    setPickOpen(true)
    void loadItems()
  }

  async function loadPickFriends(sequence: number, append: boolean) {
    setPickError('')
    setFriendLoading(true)
    const query = new URLSearchParams({ q: friendQuery.trim() })
    if (append && friendCursor) query.set('cursor', friendCursor)
    try {
      const data = await api<{ friends: TargetFriend[]; total: number; nextCursor: string | null }>('target-friends?' + query)
      if (sequence !== friendRequest.current) return
      setPickFriends((previous) => append ? [...(previous || []), ...data.friends] : data.friends)
      setFriendTotal(data.total)
      setFriendCursor(data.nextCursor)
    } catch {
      if (sequence === friendRequest.current) setPickError('无法加载可顺取好友，请重试。')
    } finally {
      if (sequence === friendRequest.current) setFriendLoading(false)
    }
  }

  // 200–300ms 防抖；序号保证旧请求不会覆盖新搜索结果。
  useEffect(() => {
    if (!pickOpen || pickMode !== 'friends') return
    const sequence = ++friendRequest.current
    setFriendLoading(true)
    const timer = window.setTimeout(() => { void loadPickFriends(sequence, false) }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendQuery, pickOpen, pickMode])

  function closePick() {
    setPickOpen(false)
    setSelectedCodes([])
    setFriendSelected(undefined)
  }

  async function cancelPending(code: string) {
    await submitBoxItem('pending-item', { code, cancel: true })
    setSelectedCodes((previous) => previous.filter((item) => item !== code))
  }

  async function cancelAllPending() {
    // submitBoxItem owns the request lock; do not wrap these calls in another
    // perform() or the nested calls would be silently skipped.
    for (const item of pendingAttack) await cancelPending(item.code)
  }

  /** 确认道具组合：未选任我顺直接结算；选了任我顺进入服务端筛选后的好友列表。 */
  function confirmSelection() {
    const codes = ATTACK_ORDER.filter((code) => selectedCodes.includes(code))
    if (!codes.length) { closePick(); void attempt(undefined, []); return }
    if (codes.includes('TARGET_FRIEND')) {
      setFriendSelected(undefined)
      setPickMode('friends')
      return
    }
    closePick()
    void attempt(undefined, [...codes])
  }

  function confirmFriend() {
    if (!friendSelected) return
    const codes = ATTACK_ORDER.filter((code) => selectedCodes.includes(code))
    closePick()
    void attempt(friendSelected, [...codes])
  }

  function readPending<T>(action: string): T | undefined {
    if (!sessionUserId) return undefined
    try {
      const value = sessionStorage.getItem(`shun-request:${sessionUserId}:${action}`)
      return value ? JSON.parse(value) as T : undefined
    } catch { return undefined }
  }

  function savePending(action: string, value?: unknown) {
    if (!sessionUserId) return
    const key = `shun-request:${sessionUserId}:${action}`
    try {
      if (value === undefined) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, JSON.stringify(value))
    } catch { /* The in-memory request is still available in this tab. */ }
  }

  function isRejectedRequest(error: unknown) {
    return error instanceof RequestError && error.status && error.status < 500 && error.status !== 429
  }

  async function submitBoxItem(action: string, fields: Record<string, unknown> = {}) {
    await perform(action, async () => {
      setBoxError('')
      const key = JSON.stringify([action, fields])
      const itemRequestId = boxRequests.current.get(key) ?? readPending<string>(key) ?? crypto.randomUUID()
      boxRequests.current.set(key, itemRequestId)
      savePending(key, itemRequestId)
      try {
        if (action === 'gift') {
          setDelivery(undefined)
          setDelivery(await api<GiftDelivery>('gift', { requestId: itemRequestId }))
        } else {
          await api(action, { ...fields, requestId: itemRequestId })
        }
        boxRequests.current.delete(key)
        savePending(key)
        await Promise.all([loadStatus(), loadItems(), ...(action.startsWith('capture/') ? [loadRecords()] : [])])
      } catch (error) {
        if (isRejectedRequest(error)) {
          boxRequests.current.delete(key)
          savePending(key)
        }
        if (boxOpen) setBoxError(error instanceof Error ? error.message : '暂时无法使用道具。')
        else throw error
      }
    })
  }

  function attempt(friendId?: string, items?: string[]) {
    return perform('attempt', async () => {
      setResult(undefined)
      setStep('result')
      setError('')
      setNotice('')
      const pending = readPending<{ id: string; friendId?: string; items?: string[] }>('attempt')
      if (!requestId.current && pending) {
        requestId.current = pending.id
        targetRequest.current = pending.friendId
        attemptItems.current = pending.items
      }
      const nextItems = JSON.stringify(items ?? [])
      if (requestId.current && (friendId !== targetRequest.current || nextItems !== JSON.stringify(attemptItems.current ?? []))) {
        throw new RequestError('请先重试上一笔顺取。')
      }
      if (!requestId.current) {
        targetRequest.current = friendId
        attemptItems.current = items ?? []
        requestId.current = crypto.randomUUID()
        savePending('attempt', { id: requestId.current, friendId, items: attemptItems.current })
      }
      // The same request id is reused after a timeout, refresh or retry, so a
      // committed settlement is never repeated with a fresh random draw.
      slowNotice.current = window.setTimeout(() => setNotice('还在寻找幸运的 EF，请稍候…'), 3000)
      slowNotice2.current = window.setTimeout(() => setNotice('正在确认顺取结果，请勿重复操作。'), 10000)
      try {
        const round = await api<Round>('attempt', {
          requestId: requestId.current,
          friendId: targetRequest.current,
          items: attemptItems.current ?? [],
        })
        requestId.current = null
        attemptItems.current = undefined
        savePending('attempt')
        setMessage('')
        setNotice('')
        setStep('result')
        setResult(round)
        setBusy('')
        // Result first: history/inventory refresh is off the critical path.
        void Promise.all([loadStatus(), loadItems(), loadRecords()])
      } catch (error) {
        if (isRejectedRequest(error)) {
          requestId.current = null
          attemptItems.current = undefined
          savePending('attempt')
        }
        if (error instanceof RequestError && error.code === 'SHUN_CLOSED') void loadStatus()
        throw error
      } finally {
        window.clearTimeout(slowNotice.current)
        window.clearTimeout(slowNotice2.current)
      }
    })
  }
  /**
   * "No letter" and "close" both end in the ordinary notification.
   *
   * The request is idempotent server-side, and if it fails the server-side sweep
   * still delivers the plain notification, so a lost response can never leave
   * the victim unnotified.
   */
  async function sendPlain(continueTaking = false) {
    const round = result
    if (!round || lock.current || step === 'sending') return
    lock.current = true
    let notified = false
    setBusy('notify')
    setError('')
    try {
      await api<{ status: string }>(`round/${round.id}/notify`, {})
      notified = true
      setResult(undefined)
      setStep('result')
      setMessage('')
      setNotice(continueTaking ? '' : '今日收工，明天继续！')
      await Promise.all([loadStatus(), loadRecords()])
    } catch (error) {
      setError(error instanceof Error ? error.message : '通知发送失败，请重试。')
    } finally {
      lock.current = false
      setBusy('')
    }
    if (notified && continueTaking) startTake()
  }
  /** Sends the letter, then plays the delivery animation — only after the server confirms. */
  async function sendLetter() {
    const round = result
    const content = message.trim()
    if (!round || lock.current || !content) return
    lock.current = true
    setBusy('letter')
    setError('')
    setStep('sending')
    try {
      const outcome = await api<{ status: string }>(`round/${round.id}/letter`, { message: content })
      if (outcome.status !== 'SENT_LETTER') throw new RequestError('本次通知已发送，无法再补充匿名留言。', 'ALREADY_NOTIFIED')
      // Close the native dialog now, not in the later effect: <dialog>.showModal()
      // enters the browser top layer, which would sit above the portalled skip
      // button for a frame. Closing here guarantees the button is clickable from
      // the first animation frame.
      dialog.current?.close()
      setStep('animate')
      await Promise.all([loadStatus(), loadRecords()])
    } catch (error) {
      if (error instanceof RequestError && error.code === 'ALREADY_NOTIFIED') {
        // The ordinary notice already went out (user or server sweep): the letter
        // can no longer be added, and saying "已送达" here would be a lie.
        setStep('expired')
        setError(error.message)
        await Promise.all([loadStatus(), loadRecords()])
      } else {
        setStep('write')
        setError(error instanceof Error ? error.message : '留言发送失败，请重试。')
      }
    } finally {
      lock.current = false
      setBusy('')
    }
  }
  /** Esc / 关闭: never lets a settled take stay unnotified. */
  function closeResult() {
    if (busy || step === 'sending' || step === 'animate') return
    if (step === 'delivered' || step === 'expired' || !result) { setResult(undefined); setStep('result'); return }
    void sendPlain()
  }
  async function openCapture(id: string) {    const response = await api<Capture | { record: Round }>(`capture/${id}/start`, {})
    setSelected(undefined)
    setCaught(undefined)
    setCaptureStep('result')
    setCaptureMessage('')
    if ('record' in response) { setCaught(response.record); setCapture(undefined); return }
    setClockOffset(Date.parse(response.serverNow) - Date.now())
    setCapture({ id, data: response })
  }
  function closeLetter() {
    setLetter(undefined)
    setLetterError('')
  }
  /**
   * "前往调查" reuses the exact capture-preparation call the record list uses.
   * It only opens the suspect picker — never submits an answer — so the golden
   * window, attempt rules, ledger and idempotency stay untouched.
   */
  async function investigate() {
    if (!letter || letterBusy) return
    setLetterBusy(true)
    setLetterError('')
    try {
      await openCapture(letter.roundId)
      closeLetter()
      // The picker lives in the records column, which can sit below the fold on
      // a phone; land on it (or on the settlement panel for an already settled
      // round) so the click has a visible outcome.
      setPendingFocus(['shun-capture', 'shun-caught'])
    } catch (error) {
      if (error instanceof RequestError && (error.code === 'UNAVAILABLE' || error.code === 'NOT_FOUND')) {
        setLetter((current) => current && { ...current, capturable: false })
        setLetterError(error.message)
      } else {
        setLetterError(error instanceof Error ? error.message : '暂时无法打开调查，请重试。')
      }
    } finally {
      setLetterBusy(false)
    }
  }
  /**
   * 「查看调查结果」 from a capture note. Reuses the exact capture-preparation
   * call the record list uses: it only opens the suspect picker (or the settled
   * panel) and never submits an answer, so nothing about capture is replayed.
   */
  async function investigateCaptureLetter() {
    if (!captureLetterView || captureLetterBusy) return
    setCaptureLetterBusy(true)
    setCaptureLetterError('')
    try {
      await openCapture(captureLetterView.roundId)
      setCaptureLetterView(undefined)
      setPendingFocus(['shun-capture', 'shun-caught'])
    } catch (error) {
      if (error instanceof RequestError && (error.code === 'UNAVAILABLE' || error.code === 'NOT_FOUND')) {
        setCaptureLetterError(error.message)
      } else {
        setCaptureLetterError(error instanceof Error ? error.message : '暂时无法打开调查，请重试。')
      }
    } finally {
      setCaptureLetterBusy(false)
    }
  }
  /** Closes the settled letter and lands on its row in the record list. */
  function showRecord(roundId: string) {    closeLetter()
    setSide('in')
    setPendingFocus([side === 'in' ? `shun-record-${roundId}` : 'shun-records', 'shun-records'])
  }
  function confirmCapture() {
    if (!capture || selected === undefined) return
    return perform('capture', async () => {
      try {
        const outcome = await api<{ record: Round }>(`capture/${capture.id}/guess`, { uid: selected, mode: capture.data.mode })
        setCaught(outcome.record)
        setCaptureStep('result')
        setCaptureMessage('')
        setCapture(undefined)
        setPendingFocus(['shun-caught'])
        await Promise.all([loadStatus(), loadRecords()])
        // A letter opened earlier in this session must reflect the settlement
        // instead of keeping the pre-investigation anonymous heading.
        if (letter) await openLetter(letter.id, true)
      } catch (error) {
        if (error instanceof RequestError && error.code === 'MODE_CHANGED') await openCapture(capture.id)
        throw error
      }
    })
  }
  /**
   * Capture result: "no note" and "close" both end in the ordinary arrest
   * notice. The request is idempotent and the server sweep is the backstop, so
   * a lost response can never leave the caught actor unaware.
   */
  async function sendCapturePlain() {
    const round = caught
    if (!round || lock.current || captureStep === 'sending') return
    lock.current = true
    setBusy('capture-notify')
    setError('')
    try {
      await api<{ status: string }>(`round/${round.id}/captured`, {})
      setCaught(undefined)
      setCaptureStep('result')
      setCaptureMessage('')
      setNotice('已发送被抓通知。')
      await Promise.all([loadStatus(), loadRecords()])
    } catch (error) {
      setError(error instanceof Error ? error.message : '通知发送失败，请重试。')
    } finally {
      lock.current = false
      setBusy('')
    }
  }
  /** Sends the counter note, then plays the shared delivery animation. */
  async function sendCaptureLetter() {
    const round = caught
    const content = captureMessage.trim()
    if (!round || lock.current || !content) return
    lock.current = true
    setBusy('capture-letter')
    setError('')
    setCaptureStep('sending')
    try {
      const outcome = await api<{ status: string }>(`round/${round.id}/capture-letter`, { message: content })
      if (outcome.status !== 'SENT_LETTER') throw new RequestError('抓捕通知已发送，无法再补充留言。', 'ALREADY_NOTIFIED')
      setCaptureStep('animate')
      await Promise.all([loadStatus(), loadRecords()])
    } catch (error) {
      if (error instanceof RequestError && error.code === 'ALREADY_NOTIFIED') {
        // The ordinary arrest notice already went out: saying "已送达" for a
        // note that was never stored would be a lie.
        setCaptureStep('expired')
        setError(error.message)
        await Promise.all([loadStatus(), loadRecords()])
      } else {
        setCaptureStep('write')
        setError(error instanceof Error ? error.message : '留言发送失败，请重试。')
      }
    } finally {
      lock.current = false
      setBusy('')
    }
  }
  /** Esc / 关闭 on the capture result: never lets a settled capture go unnoticed. */
  function closeCaptureResult() {
    if (busy || captureStep === 'sending' || captureStep === 'animate') return
    const settled = !!caught && caught.result === 'SUCCESS'
    // Nothing left to notify when the note was already delivered, the notice
    // already expired, or the capture failed.
    if (!settled || captureStep === 'delivered' || captureStep === 'expired' || caught?.hasCaptureLetter) {
      setCaught(undefined)
      setCaptureStep('result')
      setCaptureMessage('')
      return
    }
    void sendCapturePlain()
  }
  const rows = list?.focused && !list.records.some((round) => round.id === list.focused?.id)
    ? [list.focused, ...list.records] : list?.records || []
  const myTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' })
  const remaining = (deadline: string) => Math.max(0, Math.ceil((Date.parse(deadline) - (now ?? Date.now())) / 1000))
  const countdown = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  const messageLength = [...message.trim()].length
  // The letter is free: it must stay sendable even when this take used the last
  // daily attempt.
  const canSend = messageLength > 0 && messageLength <= MESSAGE_MAX && !busy
  // Same 60-character contract for the capture counter note.
  const captureLength = [...captureMessage.trim()].length
  const canSendCapture = captureLength > 0 && captureLength <= MESSAGE_MAX && !busy
  const investigation = (recordId: string | undefined) => <>
        {capture && capture.id === recordId && <section className={styles.capture} aria-label="抓捕追回" id="shun-capture" tabIndex={-1}>
          <h2>{(capture.data.golden ?? capture.data.mode === 2) ? `黄金抓捕期 · ${countdown(remaining(capture.data.goldenUntil))}` : capture.data.mode === 4 ? '四选一抓捕' : '三选一抓捕'}</h2>
          <fieldset><legend>选择一位 EF</legend>{capture.data.candidates.map((person) => <label key={person.uid}>
            <input type="radio" name="suspect" checked={person.uid === selected} onChange={() => setSelected(person.uid)} />
            <PersonLabel person={person} />
          </label>)}</fieldset>
          <button disabled={!!busy || selected === undefined} onClick={() => void confirmCapture()}>确认抓捕</button>
          <button disabled={!!busy} onClick={() => setCapture(undefined)}>返回记录</button>
        </section>}
        {caught && caught.id === recordId && <div className={styles.result} role="status" id="shun-caught" tabIndex={-1}>
          {caught.result !== 'SUCCESS' ? <>
            <strong>让 TA 溜了！</strong>
            <PersonLabel person={caught.person} link />
            <p>{caught.amount} 挂号费未追回</p>
            <div className={styles.stackedActions}>
              <button type="button" className={styles.wide} onClick={() => { setCaught(undefined); setCaptureStep('result') }}>返回记录</button>
            </div>
          </> : captureStep === 'delivered' || captureStep === 'expired' ? <>
            <strong>{captureStep === 'delivered' ? '留言已送达！✉️' : '本次通知已发送'}</strong>
            <p className={styles.letterSent}>{captureStep === 'delivered'
              ? '你的留言已经送给被抓到的 EF。'
              : '抓捕通知已经送达，无法再补充留言。'}</p>
            <div className={styles.tabs}>
              {/* Permanent opt-out removes every new take entry point, but the
                  already-settled capture note flow still completes. */}
              <button type="button" autoFocus
                disabled={!!busy || status?.optedOut || !status?.enabled || !status?.remaining || !openNow}
                onClick={() => { setCaught(undefined); setCaptureStep('result'); setCaptureMessage(''); startTake() }}>
                {status?.optedOut ? '已退出顺大师' : !openNow ? '休息中 💤'
                  : status?.remaining ? '再顺一手' : '今日次数已用完'}
              </button>
              <button type="button" onClick={() => { setCaught(undefined); setCaptureStep('result'); setCaptureMessage('') }}>返回顺大师</button>
            </div>
          </> : captureStep === 'write' || captureStep === 'sending' ? <>
            <strong>给被抓到的 EF 留句话</strong>
            <PersonLabel person={caught.person} link />
            <p>成功追回 {caught.recovered} 挂号费{caught.bonusAwarded ? ` · 额外奖励 ${caught.bonusAwarded}` : ''}</p>
            <textarea aria-label="反击留言内容" placeholder="抓到你啦！有什么想对 TA 说的？" value={captureMessage} autoFocus
              onChange={(event) => {
                const next = event.target.value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
                setCaptureMessage([...next].slice(0, MESSAGE_MAX).join(''))
              }} />
            <div className={styles.composeMeta}><span>{captureLength}/{MESSAGE_MAX}</span><span>这条留言会署名</span></div>
            <div className={styles.composeActions}>
              <button type="button" className={`${styles.primary} ${styles.wide}`} disabled={!canSendCapture || captureStep === 'sending'}
                onClick={() => void sendCaptureLetter()}>{captureStep === 'sending' ? '发送中…' : '发送留言'}</button>
              <button type="button" disabled={!!busy || captureStep === 'sending'}
                onClick={() => { setError(''); setCaptureStep('result') }}>返回</button>
              <button type="button" disabled={!!busy || captureStep === 'sending'} onClick={closeCaptureResult}>关闭</button>
            </div>
          </> : <>
            <strong>抓到你啦！</strong>
            <PersonLabel person={caught.person} link />
            <p>成功追回 {caught.recovered} 挂号费</p>
            {!!caught.bonusAwarded && <div className={styles.bonus} data-shun-bonus>
              <strong>意外惊喜！🎉</strong>
              <p>额外获得 {caught.bonusAwarded} 挂号费！</p>
              <p>本次共获得 {caught.recovered + caught.bonusAwarded} 挂号费</p>
            </div>}
            {caught.hasCaptureLetter
              ? <p className={styles.letterSent}>你已经给 TA 留过一句话，无法再补充。</p>
              : <p className={styles.letterSent}>要不要给 TA 留句话？不留言也可以。</p>}
            <div className={styles.composeActions}>
              {!caught.hasCaptureLetter && <>
                <button type="button" className={`${styles.primary} ${styles.wide}`} disabled={!!busy}
                  onClick={() => { setError(''); setCaptureStep('write') }}>给 TA 留句话</button>
                <button type="button" disabled={!!busy} onClick={() => void sendCapturePlain()}>
                  {busy === 'capture-notify' ? '发送中…' : '不留言'}
                </button>
              </>}
              <button type="button" className={caught.hasCaptureLetter ? styles.wide : undefined} disabled={!!busy} onClick={closeCaptureResult}>关闭</button>
            </div>
          </>}
        </div>}
  </>
  return <main className={styles.page}>
    {/* 标题区从首屏就固定左对齐，右侧动作位始终存在，加载中只显示固定宽度占位，
        避免库存回来后标题从居中跳到左侧。 */}
    <header className={styles.heading}>
      <ShunMasterLogo size={38} />
      <div className={styles.headingText}><h1>顺大师</h1><p>顺手一牵，缘分随天。</p></div>
      <div className={styles.headingAction}>
        {box?.enabled
          ? <button type="button" className={styles.itemToggle} onClick={() => { setBoxError(''); setBoxOpen(true); void loadItems() }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9l1.6-4h14.8L21 9M12 9v12M9.5 5.5 10 9M14.5 5.5 14 9" />
            </svg>
            <span className={styles.itemToggleText}>百宝箱 · {box.total}</span>
            {newItems && <span className={styles.itemDot} aria-label="有新道具" />}
          </button>
          : box === undefined
            // 数据未返回：占位与真实按钮同宽，且不显示库存 0。
            ? <span className={styles.itemToggleSkeleton} aria-label="百宝箱加载中" role="status" />
            : null}
      </div>
    </header>
    {box?.enabled && <ShunItemBox box={box} open={boxOpen} busy={!!busy} errorMessage={boxError} gifting={busy === 'gift'} delivery={delivery}
      onClose={() => setBoxOpen(false)} onUse={submitBoxItem} onTarget={(friendId) => { setBoxOpen(false); void attempt(friendId, [...pendingAttack.map((item) => item.code), 'TARGET_FRIEND']) }} />}
    {error && <p className={styles.alert} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.columns}>
      <section className={styles.panel} data-matching={busy === 'animation'}>
        <ShunMasterArt />
        {guest && <Link href="/login?callbackUrl=%2Fshun-master">登录参与顺大师</Link>}
        {!guest && !status && <button onClick={() => void loadStatus()}>刷新状态</button>}
        {status && <>
          <dl className={styles.stats}>
            <div><dt>我的挂号费</dt><dd className={String(status.balance).length >= 8 ? styles.longBalance : undefined}><svg className={styles.coin} data-shun-balance-icon aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#9b6a2d" strokeWidth="1.7"><circle cx="12" cy="12" r="10" /><path d="M9 12h6m-3-3v6" strokeLinecap="round" /></svg>{status.balance}</dd></div>
            <div><dt>今日剩余</dt><dd>{status.remaining}</dd></div><div><dt>今日被顺</dt><dd>{status.received}</dd></div>
          </dl>
          {/* V4.2.1 顺手牵羊快捷入口：仅在持有且当天可参与时出现，服务端仍校验每日上限。 */}
          {!status.optedOut && status.enabled && openNow && usableItem('EXTRA_ATTEMPT') && <div className={styles.quickRow}>
            {extraConfirm ? <>
              <span>增加一次今日主动顺取机会？</span>
              <button type="button" className={styles.quickItem} disabled={!!busy}
                onClick={() => { void submitBoxItem('extra-attempt').then(() => setExtraConfirm(false)) }}>确认使用</button>
              <button type="button" disabled={!!busy} onClick={() => setExtraConfirm(false)}>取消</button>
            </> : <button type="button" className={styles.quickItem} disabled={!!busy}
              onClick={() => { setError(''); setExtraConfirm(true) }}>顺手牵羊 · 增加 1 次顺取机会</button>}
          </div>}
          {status.optedOut ? <p className={styles.optedOut} role="status">
            <strong>你已永久退出顺大师</strong>
            <span>今后你不会再被顺取挂号费，也无法继续顺取其他 EF。</span>
          </p> : !status.enabled ? <p>顺大师暂未开放，敬请期待。</p> : <>
            {/* 休息提示：标题与两行说明全部来自服务端配置，后台改时间即时生效。 */}
            {!openNow && openHours && <section className={styles.closed} role="status" aria-live="polite">
              <strong>{SHUN_CLOSED_TITLE}</strong>
              <p>{shunOpenHoursHint(openHours)}</p>
              <p className={styles.hours}>{shunOpenHoursLine(openHours)}</p>
            </section>}
            <button className={styles.primary} disabled={!!busy || !status.remaining || !openNow} onClick={startTake}>
              {busy === 'animation' ? '看看哪个 EF 这么幸运...' : busy === 'attempt' ? '顺取中…'
                : !openNow ? '休息中 💤' : status.remaining ? '顺一手' : '今日收工，明天继续！'}
            </button>
          </>}
        </>}
        <details><summary>玩法说明</summary>
          <h2>顺大师 · 玩法说明</h2>
          <p>顺一手，缘分随天。</p>
          <p>每天有 {status?.attempts ?? 7} 次「顺一手」的机会，每次随机顺走一位幸运 EF 的 1–7 挂号费。每位用户每日最多被普通顺取 {status?.victimCap ?? 4} 次，另可被任我顺顺取 1 次。</p>
          <p>任我顺、碌卡、十面埋伏可同时使用，效果叠加生效。</p>
          <p>被顺走挂号费后，你会收到站内通知，并获得一次抓捕机会。</p>
          <p>{status?.goldenMinutes ?? 10} 分钟内抓捕：二选一。</p>
          <p>超过 {status?.goldenMinutes ?? 10} 分钟：三选一。</p>
          <p>猜中即可追回被顺走的挂号费，猜错则无法追回。</p>
          <p>每日机会于北京时间 00:00 重置。</p>
          {openHours && <p>{shunOpenHoursHelp(openHours)}</p>}
          <div className={styles.optOutArea}>
            {status?.optedOut
              ? <p className={styles.optOutDone}>你已永久退出顺大师，无法重新加入。</p>
              : <>
                <p>不想参与顺大师？</p>
                <p>你可以选择永久退出，退出后无法重新加入。</p>
                <button type="button" className={styles.optOutLink} onClick={() => { setOptOutAck(false); setOptOutOpen(true) }}>永久退出顺大师</button>
              </>}
          </div>
        </details>
      </section>
      {status && <section className={styles.panel} aria-label="历史记录" id="shun-records" tabIndex={-1}>
        <div className={styles.tabs} aria-label="记录类别">
          <button aria-pressed={side === 'out'} onClick={() => { setSide('out'); setCapture(undefined); setCaught(undefined); setCaptureStep('result'); setCaptureMessage('') }}>我顺了谁</button>
          <button aria-pressed={side === 'in'} onClick={() => { setSide('in'); setCapture(undefined); setCaught(undefined); setCaptureStep('result'); setCaptureMessage('') }}>谁顺了我</button>
        </div>
        <div className={styles.filters}>
          <label>记录日期 <select value={range} onChange={(event) => setRange(event.target.value)}>
            <option value="all">全部记录</option><option value="today">今天</option><option value="yesterday">昨天</option>
            <option value="week">本周</option><option value="date">选择日期</option>
          </select></label>
          {range === 'date' && <input type="date" aria-label="选择北京时间日期" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />}
        </div>
        {rows.map((row) => <article className={styles.record} key={row.id} id={`shun-record-${row.id}`} tabIndex={-1}>
          <PersonLabel person={row.person} link />
          <p>{myTime.format(new Date(row.createdAt))} · {side === 'in' ? '−' : '+'}{row.amount} 挂号费</p>
          {row.result && <p>{row.result === 'SUCCESS' ? `已追回 ${row.recovered} 挂号费` : '抓捕失败 · 未追回'}</p>}
          {side === 'in' && row.hasLetter && (
            // Re-read entry: the letter is fetched again from the recipient-only
            // endpoint, so it stays available without replaying the delivery
            // animation and without depending on the notification row.
            <button disabled={!!busy} onClick={() => void perform('letter', () => openLetter(row.id, true))}>查看神秘来信</button>
          )}
          {side === 'in' && !row.result && (row.canCapture ? <>
            {remaining(row.goldenUntil) > 0 && <span>黄金抓捕期 · {countdown(remaining(row.goldenUntil))}</span>}
            <button disabled={!!busy} onClick={() => capture?.id === row.id ? setCapture(undefined) : void perform('start', () => openCapture(row.id))}>{capture?.id === row.id ? '收起调查' : '立即调查'}</button>
          </> : <p>可用嫌疑人不足，本次不可抓捕。</p>)}
          {row.itemOutcomes?.map((effect) => <p key={effect.code} role="status">
            {effect.code === 'RETRY_CAPTURE' ? `时光倒流 · 已追回 ${effect.amount} 挂号费` : `最佳损友 · 反击 ${effect.amount} 挂号费`}
          </p>)}
          {side === 'in' && row.result === 'FAILED' && !row.itemOutcomes?.some(({ code }) => code === 'RETRY_CAPTURE') && usableItem('RETRY_CAPTURE') &&
            <button type="button" disabled={!!busy} onClick={() => void submitBoxItem(`capture/${row.id}/retry-item`)}>使用时光倒流</button>}
          {side === 'in' && (row.result === 'SUCCESS' || row.itemOutcomes?.some(({ code }) => code === 'RETRY_CAPTURE')) &&
            !row.itemOutcomes?.some(({ code }) => code === 'REVENGE') && usableItem('REVENGE') &&
            <button type="button" disabled={!!busy} onClick={() => void submitBoxItem(`capture/${row.id}/revenge-item`)}>使用最佳损友</button>}
          {investigation(row.id)}
        </article>)}
        {![capture?.id, caught?.id].some((id) => id && rows.some((row) => row.id === id)) && investigation(capture?.id ?? caught?.id)}
        {loading && <p role="status">记录加载中…</p>}
        {recordError && <p role="alert">{recordError} <button onClick={() => void loadRecords()}>重试</button></p>}
        {range === 'date' && !dateKey && <p>请选择日期。</p>}
        {list && !rows.length && !loading && <p>还没有记录。</p>}
        {list?.nextCursor && <button disabled={loading} onClick={() => void loadRecords(list.nextCursor!, list.windowAt)}>加载更多</button>}
      </section>}
    </div>
    <dialog ref={dialog} className={styles.modal} aria-labelledby="shun-result-title"
      onCancel={(event) => { event.preventDefault(); closeResult() }}>
      {result && <div className={styles.modalBody}>
        {step === 'delivered' || step === 'expired' ? <>
          <h2 id="shun-result-title">{step === 'delivered' ? '匿名留言已送达！' : '本次通知已发送'}</h2>
          <p className={styles.letterSent}>{step === 'delivered'
            ? 'TA 会在收到挂号费被顺走的同时，读到只有 TA 能看到的这句话。'
            : '普通通知已经送达，无法再补充匿名留言。'}</p>
          <div className={styles.stackedActions}>
            {status?.remaining && status.enabled && openNow
              ? <button type="button" className={styles.wide} disabled={!!busy} onClick={startTake}>再顺一手</button>
              : <><p>{status?.remaining ? '当前暂不可顺取。' : '今日收工，明天继续！'}</p>
                <button type="button" className={styles.wide} onClick={() => { setResult(undefined); setStep('result') }}>完成</button></>}
          </div>
        </> : <>
          <h2 id="shun-result-title">{step === 'write' ? '给 TA 留一句匿名的话' : '顺走啦！'}</h2>
          <PersonLabel person={result.person} link />
          {result.person && <p className={styles.uid}>UID {formatUid(result.person.uid)}</p>}
          {step === 'write' || step === 'sending' ? <>
            <textarea aria-label="匿名留言内容" placeholder="写下一句只有 TA 才能看到的话……" value={message} autoFocus
              onChange={(event) => {
                const next = event.target.value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
                setMessage([...next].slice(0, MESSAGE_MAX).join(''))
              }} />
            <div className={styles.composeMeta}><span>{messageLength}/{MESSAGE_MAX}</span><span>TA 不会知道是你</span></div>
            <div className={styles.composeActions}>
              <button type="button" className={`${styles.primary} ${styles.wide}`} disabled={!canSend || step === 'sending'}
                onClick={() => void sendLetter()}>{step === 'sending' ? '发送中…' : '发送匿名留言'}</button>
              <button type="button" disabled={!!busy || step === 'sending'} onClick={() => { setError(''); setStep('result') }}>取消留言</button>
            </div>
          </> : <>
            <strong>+{result.amount} 挂号费</strong>
            {!!result.usedItems?.length && <div className={styles.usedItems} aria-label="已使用道具">
              <span>已使用道具</span>
              {result.usedItems.map((item) => <span key={item.code}>{item.name}</span>)}
            </div>}
            <p className={styles.letterSent}>要不要给 TA 留一句匿名的话？不留言也可以。</p>
            <div className={styles.stackedActions}>
              <button type="button" className={`${styles.primary} ${styles.wide}`} disabled={!!busy}
                onClick={() => { setError(''); setStep('write') }}>匿名留言</button>
              <button type="button" className={styles.wide} disabled={!!busy} onClick={() => void sendPlain(Boolean(status?.remaining))}>{busy === 'notify' ? '发送中…' : status?.remaining ? '不留言并再顺一手' : '不留言'}</button>
            </div>
          </>}
        </>}
      </div>}
    </dialog>
    {/* V4.2.4 顺取前道具选择：多层弹窗均不消耗道具与次数。 */}
    {pickOpen && <div className={styles.optOutOverlay} role="dialog" aria-modal="true" aria-labelledby="shun-pick-title">
      <div className={styles.pickCard} data-mode={pickMode}>
        <header className={styles.pickHeader}>
          <h2 id="shun-pick-title">{pickMode === 'choose' ? '要使用道具吗？'
            : pickMode === 'items' ? '选择本次使用的道具' : '任我顺 · 选择好友'}</h2>
          <button type="button" className={styles.dialogClose} aria-label="关闭" disabled={!!busy} onClick={closePick}>×</button>
        </header>
        {pickError && <p role="alert">{pickError}</p>}
        {pickMode === 'choose' && <>
          <p>选择道具，让这一次顺取更有意思。</p>
          <div className={styles.tabs}>
            <button type="button" className={styles.primary} disabled={!!busy} onClick={() => setPickMode('items')}>使用道具</button>
            <button type="button" disabled={!!busy} onClick={() => { closePick(); void attempt(undefined, []) }}>不使用道具</button>
          </div>
        </>}
        {pickMode === 'items' && <>
          <p>可同时选择多种道具，效果将叠加生效。</p>
          {!!pendingAttack.length && <div className={styles.pendingRow}>
            <span>待生效：{pendingAttack.map((item) => selectedName(item.code)).join('、')}</span>
            <button type="button" className={styles.optOutLink} disabled={!!busy}
              onClick={() => void cancelAllPending()}>全部取消</button>
          </div>}
          <ul className={styles.multiItems}>
            {takeItems.map((item) => {
              const checked = selectedCodes.includes(item.code)
              return <li key={item.code}>
                <button type="button" aria-pressed={checked} className={checked ? styles.itemSelected : undefined}
                  disabled={!!busy || item.available < 1} onClick={() => setSelectedCodes((previous) =>
                    checked ? previous.filter((code) => code !== item.code) : [...previous, item.code])}>
                  <span className={styles.multiIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d={item.icon} />
                    </svg>
                  </span>
                  <span className={styles.multiBody}>
                    <strong>{item.name} <em>×{item.available}</em></strong>
                    <small>{item.rarity} · {item.description}</small>
                  </span>
                  <span className={styles.multiCheck} aria-hidden="true">{checked ? '✓' : ''}</span>
                </button>
              </li>
            })}
          </ul>
          {!takeItems.length && <p>当前没有可用于本次顺取的道具。</p>}
          <div className={styles.effectPreview}>
            <strong>本次顺取效果</strong>
            {previewLines.length ? previewLines.map((line) => <span key={line}>{line}</span>)
              : <span>普通顺取，不使用道具。</span>}
            <small>已选择{selectedCodes.length}种道具</small>
          </div>
          <div className={styles.pickFooter}>
            <button type="button" disabled={!!busy} onClick={() => setPickMode('choose')}>返回</button>
            <button type="button" className={styles.primary} disabled={!!busy || !selectedCodes.length} onClick={confirmSelection}>
              {selectedCodes.includes('TARGET_FRIEND') ? '选择好友' : '确认使用并顺取'}
            </button>
          </div>
        </>}
        {pickMode === 'friends' && <>
          <p>仅显示当前可顺取的好友。未出现的好友可能已达到今日被顺取上限。</p>
          {selectedCodes.length > 1 && <div className={styles.comboSummary}>
            已选道具：{selectedCodes.map((code) => selectedName(code)).join('、')}
          </div>}
          <input className={styles.friendSearch} aria-label="搜索好友" value={friendQuery}
            placeholder="搜索昵称、UID、好友ID或备注" onChange={(event) => setFriendQuery(event.target.value)} />
          <ul className={styles.friendList}>
            {pickFriends?.map((friend) => {
              const avatar = publicImageUrl(friend.avatarUrl)
              const active = friendSelected === friend.id
              return <li key={friend.id}>
                <button type="button" aria-pressed={active} className={active ? styles.friendActive : undefined}
                  onClick={() => setFriendSelected(friend.id)}>
                  {avatar
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={avatar} alt="" width={36} height={36} />
                    : <span className={styles.friendAvatar} aria-hidden="true">EF</span>}
                  <span className={styles.friendMeta}>
                    <strong>{friend.displayName}</strong>
                    <small>UID {formatUid(friend.uid)}{friend.remark ? ` · ${friend.remark}` : ''}</small>
                  </span>
                  <span className={styles.friendCheck} aria-hidden="true">{active ? '✓' : ''}</span>
                </button>
              </li>
            })}
          </ul>
          {friendLoading && <p role="status">好友加载中…</p>}
          {pickFriends && !pickFriends.length && !friendLoading && <p role="status">
            {friendQuery ? '没有找到符合条件的好友。' : '暂时没有可顺取的好友，稍后再来看看吧。'}
          </p>}
          {friendCursor && !friendLoading && <button type="button" disabled={!!busy}
            onClick={() => void loadPickFriends(friendRequest.current, true)}>加载更多（共 {friendTotal} 位）</button>}
          <div className={styles.pickFooter}>
            <button type="button" disabled={!!busy} onClick={() => setPickMode('items')}>返回</button>
            <button type="button" className={styles.primary} disabled={!!busy || !friendSelected} onClick={confirmFriend}>确认顺取</button>
          </div>
        </>}
      </div>
    </div>}
    {step === 'animate' && <SendAnonymousLetter message={message.trim()} onComplete={() => {
      // The letter is already stored: the animation only reveals the result.
      setStep('delivered')
      setMessage('')
    }} />}
    {/* Capture counter note: the very same component, CSS timeline and skip
        button — only the accessible label differs. */}
    {captureStep === 'animate' && caught && <SendAnonymousLetter variant="capture" message={captureMessage.trim()} onComplete={() => {
      // The note is already stored: the animation only reveals the result.
      setCaptureStep('delivered')
      setCaptureMessage('')
    }} />}
    {letter && <AnonymousLetter letter={letter} busy={letterBusy} error={letterError} instant={letterInstant}
      onInvestigate={() => void investigate()} onClose={closeLetter}
      onShowRecord={() => showRecord(letter.roundId)} />}
    {captureLetterView && <CaptureLetter letter={captureLetterView} busy={captureLetterBusy} error={captureLetterError}
      onInvestigate={() => void investigateCaptureLetter()} onClose={() => { setCaptureLetterView(undefined); setCaptureLetterError('') }} />}
    {optOutOpen && <div className={styles.optOutOverlay} role="dialog" aria-modal="true" aria-labelledby="opt-out-title">
      <div className={styles.optOutCard}>
        <h2 id="opt-out-title">确定永久退出顺大师？</h2>
        <p>退出后，你将无法再顺取其他 EF 的挂号费，也不会再被其他 EF 顺取。退出前的游戏记录和挂号费结算均会保留。</p>
        <p className={styles.optOutWarning}>此操作永久生效，确认后无法重新加入。</p>
        <label className={styles.optOutAck}>
          <input type="checkbox" checked={optOutAck} onChange={(event) => setOptOutAck(event.target.checked)} />
          <span>我已了解，永久退出后无法重新加入。</span>
        </label>
        <div className={styles.tabs}>
          <button type="button" onClick={() => { setOptOutOpen(false); setOptOutAck(false) }} disabled={busy === 'opt-out'}>取消</button>
          <button type="button" className={styles.primary} disabled={!optOutAck || busy === 'opt-out'} onClick={() => void confirmOptOut()}>
            {busy === 'opt-out' ? '处理中…' : '确认永久退出'}
          </button>
        </div>
      </div>
    </div>}
  </main>
}
