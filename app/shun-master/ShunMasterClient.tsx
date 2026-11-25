'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ShunMasterArt } from '@/components/ShunMasterArt'
import { ShunMasterLogo } from '@/components/ShunMasterLogo'
import { AnonymousLetter, type AnonymousLetterData } from '@/components/shun-master/AnonymousLetter'
import { CaptureLetter, type CaptureLetterData } from '@/components/shun-master/CaptureLetter'
import { SendAnonymousLetter } from '@/components/shun-master/SendAnonymousLetter'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import styles from './shun.module.css'

const MESSAGE_MAX = 60

type Person = { uid: number; nickname: string; avatarUrl: string | null }
type Round = { id: string; amount: number; recovered: number; result: 'SUCCESS' | 'FAILED' | null
  createdAt: string; goldenUntil: string; person: Person | null; canCapture: boolean; hasLetter?: boolean
  /** Platform bonus granted on a successful capture (0 when the roll lost). */
  bonusAwarded?: number
  /** Capturer side: this capture already carries a delivered counter note. */
  hasCaptureLetter?: boolean }
type Status = { enabled: boolean; optedOut: boolean; balance: number; remaining: number; received: number; attempts: number; victimCap: number; goldenMinutes: number; serverNow: string }
type Records = { records: Round[]; focused: Round | null; nextCursor: string | null; windowAt: string }
type Capture = { mode: number; candidates: Person[]; serverNow: string; goldenUntil: string }
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

export function ShunMasterClient({ focusedRecord, initialSide, initialGuest, autoLetterId, autoCaptureLetterId }: {
  focusedRecord?: string; initialSide: Side; initialGuest: boolean; autoLetterId?: string
  /** V5:一-shot flag from a capture notice that carries a counter note. */
  autoCaptureLetterId?: string
}) {
  const [status, setStatus] = useState<Status>()
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
  useEffect(() => { if (!initialGuest) void loadStatus() }, [initialGuest, loadStatus])
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
  function attempt() {
    return perform('attempt', async () => {
      setResult(undefined)
      setStep('result')
      setError('')
      requestId.current ||= crypto.randomUUID()
      try {
        const round = await api<Round>('attempt', { requestId: requestId.current })
        setBusy('animation')
        const wait = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1600
        await Promise.all([
          loadStatus(), loadRecords(),
          new Promise((resolve) => window.setTimeout(resolve, wait)),
        ])
        requestId.current = null
        setMessage('')
        setNotice('')
        setStep('result')
        setResult(round)
      } catch (error) {
        if (error instanceof RequestError && error.status && error.status < 500 && error.status !== 429) requestId.current = null
        throw error
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
  async function sendPlain() {
    const round = result
    if (!round || lock.current || step === 'sending') return
    lock.current = true
    setBusy('notify')
    setError('')
    try {
      await api<{ status: string }>(`round/${round.id}/notify`, {})
      setResult(undefined)
      setStep('result')
      setMessage('')
      setNotice('已发送被顺通知。')
      await Promise.all([loadStatus(), loadRecords()])
    } catch (error) {
      setError(error instanceof Error ? error.message : '通知发送失败，请重试。')
    } finally {
      lock.current = false
      setBusy('')
    }
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
  return <main className={styles.page}>
    <header className={styles.heading}><ShunMasterLogo size={38} /><div><h1>顺大师</h1><p>顺手一牵，缘分随天。</p></div></header>
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
          {status.optedOut ? <p className={styles.optedOut} role="status">
            <strong>你已永久退出顺大师</strong>
            <span>今后你不会再被顺取挂号费，也无法继续顺取其他 EF。</span>
          </p> : !status.enabled ? <p>顺大师暂未开放，敬请期待。</p> : <button className={styles.primary} disabled={!!busy || !status.remaining} onClick={() => void attempt()}>
            {busy === 'animation' ? '看看哪个 EF 这么幸运...' : busy === 'attempt' ? '顺取中…' : status.remaining ? '顺一手' : '今日收工，明天继续！'}
          </button>}
        </>}
        <details><summary>玩法说明</summary>
          <h2>顺大师 · 玩法说明</h2>
          <p>顺一手，缘分随天。</p>
          <p>每天有 {status?.attempts ?? 7} 次「顺一手」的机会，每次随机顺走一位幸运 EF 的 1–7 挂号费，每人每天最多被顺 {status?.victimCap ?? 4} 次。</p>
          <p>被顺走挂号费后，你会收到站内通知，并获得一次抓捕机会。</p>
          <p>{status?.goldenMinutes ?? 10} 分钟内抓捕：二选一。</p>
          <p>超过 {status?.goldenMinutes ?? 10} 分钟：三选一。</p>
          <p>猜中即可追回被顺走的挂号费，猜错则无法追回。</p>
          <p>每日机会于北京时间 00:00 重置。</p>
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
        {capture && <section className={styles.capture} aria-label="抓捕追回" id="shun-capture" tabIndex={-1}>
          <h2>{capture.data.mode === 2 ? `黄金抓捕期 · ${countdown(remaining(capture.data.goldenUntil))}` : '三选一抓捕'}</h2>
          <fieldset><legend>选择一位 EF</legend>{capture.data.candidates.map((person) => <label key={person.uid}>
            <input type="radio" name="suspect" checked={person.uid === selected} onChange={() => setSelected(person.uid)} />
            <PersonLabel person={person} />
          </label>)}</fieldset>
          <button disabled={!!busy || selected === undefined} onClick={() => void confirmCapture()}>确认抓捕</button>
          <button disabled={!!busy} onClick={() => setCapture(undefined)}>返回记录</button>
        </section>}
        {caught && <div className={styles.result} role="status" id="shun-caught" tabIndex={-1}>
          {caught.result !== 'SUCCESS' ? <>
            <strong>让 TA 溜了！</strong>
            <PersonLabel person={caught.person} link />
            <p>{caught.amount} 挂号费未追回</p>
            <button onClick={() => { setCaught(undefined); setCaptureStep('result') }}>返回记录</button>
          </> : captureStep === 'delivered' || captureStep === 'expired' ? <>
            <strong>{captureStep === 'delivered' ? '留言已送达！✉️' : '本次通知已发送'}</strong>
            <p className={styles.letterSent}>{captureStep === 'delivered'
              ? '你的留言已经送给被抓到的 EF。'
              : '抓捕通知已经送达，无法再补充留言。'}</p>
            <div className={styles.tabs}>
              {/* Permanent opt-out removes every new take entry point, but the
                  already-settled capture note flow still completes. */}
              <button type="button" autoFocus
                disabled={!!busy || status?.optedOut || !status?.enabled || !status?.remaining}
                onClick={() => { setCaught(undefined); setCaptureStep('result'); setCaptureMessage(''); void attempt() }}>
                {status?.optedOut ? '已退出顺大师' : status?.remaining ? '再顺一手' : '今日次数已用完'}
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
              <button type="button" disabled={!!busy} onClick={closeCaptureResult}>关闭</button>
            </div>
          </>}
        </div>}
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
            <button disabled={!!busy} onClick={() => void perform('start', () => openCapture(row.id))}>前往调查</button>
          </> : <p>可用嫌疑人不足，本次不可抓捕。</p>)}
        </article>)}
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
          <h2 id="shun-result-title">{step === 'delivered' ? '匿名信已送达 ✉️' : '本次通知已发送'}</h2>
          <p className={styles.letterSent}>{step === 'delivered'
            ? 'TA 会在收到挂号费被顺走的同时，读到只有 TA 能看到的这句话。'
            : '普通通知已经送达，无法再补充匿名留言。'}</p>
          <div className={styles.tabs}>
            <button type="button" disabled={!!busy || !status?.remaining || !status?.enabled}
              onClick={() => { setResult(undefined); void attempt() }}>{status?.remaining ? '再顺一手' : '今日次数已用完'}</button>
            <button type="button" autoFocus onClick={() => { setResult(undefined); setStep('result') }}>返回顺大师</button>
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
                onClick={() => void sendLetter()}>{step === 'sending' ? '发送中…' : '发送留言'}</button>
              <button type="button" disabled={!!busy || step === 'sending'} onClick={() => { setError(''); setStep('result') }}>返回</button>
              <button type="button" disabled={!!busy || step === 'sending'} onClick={closeResult}>关闭</button>
            </div>
          </> : <>
            <strong>+{result.amount} 挂号费</strong>
            <p className={styles.letterSent}>要不要给 TA 留一句匿名的话？不留言也可以。</p>
            <div className={styles.composeActions}>
              <button type="button" className={`${styles.primary} ${styles.wide}`} disabled={!!busy}
                onClick={() => { setError(''); setStep('write') }}>匿名留言</button>
              <button type="button" disabled={!!busy} onClick={() => void sendPlain()}>{busy === 'notify' ? '发送中…' : '不留言'}</button>
              <button type="button" disabled={!!busy} onClick={closeResult}>关闭</button>
            </div>
          </>}
        </>}
      </div>}
    </dialog>
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
