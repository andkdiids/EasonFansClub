'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ShunMasterArt } from '@/components/ShunMasterArt'
import { ShunMasterLogo } from '@/components/ShunMasterLogo'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import styles from './shun.module.css'

type Person = { uid: number; nickname: string; avatarUrl: string | null }
type Round = { id: string; amount: number; recovered: number; result: 'SUCCESS' | 'FAILED' | null
  createdAt: string; goldenUntil: string; person: Person | null; canCapture: boolean }
type Status = { enabled: boolean; joined: boolean; balance: number; remaining: number; received: number; attempts: number; victimCap: number; goldenMinutes: number; serverNow: string }
type Records = { records: Round[]; focused: Round | null; nextCursor: string | null }
type Capture = { mode: number; candidates: Person[]; serverNow: string; goldenUntil: string }
type Side = 'in' | 'out'

class RequestError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message) }
}

async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch('/api/shun-master/' + path, {
    cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
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

export function ShunMasterClient({ focusedRecord, initialSide }: { focusedRecord?: string; initialSide: Side }) {
  const [status, setStatus] = useState<Status>()
  const [side, setSide] = useState<Side>(initialSide)
  const [list, setList] = useState<Records>()
  const [result, setResult] = useState<Round>()
  const [capture, setCapture] = useState<{ id: string; data: Capture }>()
  const [caught, setCaught] = useState<Round>()
  const [selected, setSelected] = useState<number>()
  const [now, setNow] = useState<number>()
  const [clockOffset, setClockOffset] = useState(0)
  const [error, setError] = useState('')
  const [guest, setGuest] = useState(false)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [recordError, setRecordError] = useState('')
  const lock = useRef(false)
  const requestId = useRef<string | null>(null)
  const sequence = useRef(0)
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
  const loadRecords = useCallback(async (cursor?: string) => {
    const version = ++sequence.current
    setLoading(true)
    setRecordError('')
    if (!cursor) setList(undefined)
    const query = new URLSearchParams({ side })
    if (cursor) query.set('cursor', cursor)
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
  }, [side, focusedRecord, initialSide])
  useEffect(() => { void loadStatus() }, [loadStatus])
  const signedIn = !!status
  useEffect(() => { if (signedIn) void loadRecords() }, [signedIn, loadRecords])
  useEffect(() => {
    const update = () => setNow(Date.now() + clockOffset)
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [clockOffset])

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
  function attempt() {
    return perform('attempt', async () => {
      requestId.current ||= crypto.randomUUID()
      try {
        const wait = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1600
        const [round] = await Promise.all([
          api<Round>('attempt', { requestId: requestId.current }),
          new Promise((resolve) => window.setTimeout(resolve, wait)),
        ])
        requestId.current = null
        setResult(round)
        await Promise.all([loadStatus(), loadRecords()])
      } catch (error) {
        if (error instanceof RequestError && error.status && error.status < 500 && error.status !== 429) requestId.current = null
        throw error
      }
    })
  }
  async function openCapture(id: string) {
    const response = await api<Capture | { record: Round }>(`capture/${id}/start`, {})
    setSelected(undefined)
    if ('record' in response) { setCaught(response.record); setCapture(undefined); return }
    setClockOffset(Date.parse(response.serverNow) - Date.now())
    setCapture({ id, data: response })
  }
  function confirmCapture() {
    if (!capture || selected === undefined) return
    return perform('capture', async () => {
      try {
        const outcome = await api<{ record: Round }>(`capture/${capture.id}/guess`, { uid: selected, mode: capture.data.mode })
        setCaught(outcome.record)
        setCapture(undefined)
        await Promise.all([loadStatus(), loadRecords()])
      } catch (error) {
        if (error instanceof RequestError && error.code === 'MODE_CHANGED') await openCapture(capture.id)
        throw error
      }
    })
  }
  const rows = list?.focused && !list.records.some((round) => round.id === list.focused?.id)
    ? [list.focused, ...list.records] : list?.records || []
  const myTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' })
  const remaining = (deadline: string) => Math.max(0, Math.ceil((Date.parse(deadline) - (now ?? Date.now())) / 1000))
  const countdown = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return <main className={styles.page}>
    <header className={styles.heading}><ShunMasterLogo size={38} /><div><h1>顺大师</h1><p>顺手一牵，缘分随天。</p></div></header>
    {error && <p className={styles.alert} role="alert">{error}</p>}
    <div className={styles.columns}>
      <section className={styles.panel} data-matching={busy === 'attempt'}>
        <ShunMasterArt />
        {guest && <Link href="/login?callbackUrl=%2Fshun-master">登录参与顺大师</Link>}
        {!guest && !status && <button onClick={() => void loadStatus()}>刷新状态</button>}
        {status && <>
          <dl className={styles.stats}><div><dt>我的挂号费</dt><dd>{status.balance}</dd></div><div><dt>今日剩余</dt><dd>{status.remaining}</dd></div><div><dt>今日被顺</dt><dd>{status.received}</dd></div></dl>
          {!status.enabled && <p>顺大师暂未开放，已有记录仍可抓捕。</p>}
          {status.joined ? <>
            <button className={styles.primary} disabled={!!busy || !status.remaining || !status.enabled} onClick={() => void attempt()}>
              {busy === 'attempt' ? '看看哪个 EF 这么幸运...' : status.remaining ? (result ? '再顺一次' : '顺一手') : '今日收工，明天继续！'}
            </button>
            <button disabled={!!busy} onClick={() => void perform('membership', async () => { await api('membership', { joined: false }); await loadStatus() })}>退出后续匹配</button>
          </> : <details open={status.enabled}><summary>参与规则</summary><p>加入后每日最多被顺 {status.victimCap} 次、单次最多 7 挂号费。抓捕失败不会返还。退出后不再参与匹配，已有记录仍可抓捕。</p>
            <button className={styles.primary} disabled={!!busy || !status.enabled} onClick={() => void perform('membership', async () => {
              await api('membership', { joined: true, victimCap: status.victimCap }); await loadStatus()
            })}>同意规则并加入</button></details>}
        </>}
        {result && <div className={styles.result} role="status"><strong>顺走啦！</strong><PersonLabel person={result.person} link /><span> +{result.amount} 挂号费</span></div>}
        <details><summary>玩法说明</summary><p>以北京时间零点重置每日机会。黄金抓捕期内二选一，之后三选一。每条记录可以猜一次，猜中原额追回。</p></details>
      </section>
      {status && <section className={styles.panel} aria-label="历史记录">
        <div className={styles.tabs} aria-label="记录类别">
          <button aria-pressed={side === 'out'} onClick={() => { setSide('out'); setCapture(undefined); setCaught(undefined) }}>我顺了谁</button>
          <button aria-pressed={side === 'in'} onClick={() => { setSide('in'); setCapture(undefined); setCaught(undefined) }}>谁顺了我</button>
        </div>
        {capture && <section className={styles.capture} aria-label="抓捕追回">
          <h2>{capture.data.mode === 2 ? `黄金抓捕期 · ${countdown(remaining(capture.data.goldenUntil))}` : '三选一抓捕'}</h2>
          <fieldset><legend>选择一位 EF</legend>{capture.data.candidates.map((person) => <label key={person.uid}>
            <input type="radio" name="suspect" checked={person.uid === selected} onChange={() => setSelected(person.uid)} />
            <PersonLabel person={person} />
          </label>)}</fieldset>
          <button disabled={!!busy || selected === undefined} onClick={() => void confirmCapture()}>确认抓捕</button>
          <button disabled={!!busy} onClick={() => setCapture(undefined)}>返回记录</button>
        </section>}
        {caught && <div className={styles.result} role="status"><strong>{caught.result === 'SUCCESS' ? '抓到你啦！' : '让 TA 溜了！'}</strong>
          <PersonLabel person={caught.person} link /><p>{caught.result === 'SUCCESS' ? `追回 ${caught.recovered} 挂号费` : `${caught.amount} 挂号费未追回`}</p>
          <button onClick={() => setCaught(undefined)}>返回记录</button></div>}
        {rows.map((row) => <article className={styles.record} key={row.id}>
          <PersonLabel person={row.person} link />
          <p>{myTime.format(new Date(row.createdAt))} · {side === 'in' ? '−' : '+'}{row.amount} 挂号费</p>
          {row.result && <p>{row.result === 'SUCCESS' ? `已追回 ${row.recovered} 挂号费` : '抓捕失败 · 未追回'}</p>}
          {side === 'in' && !row.result && (row.canCapture ? <>
            {remaining(row.goldenUntil) > 0 && <span>黄金抓捕期 · {countdown(remaining(row.goldenUntil))}</span>}
            <button disabled={!!busy} onClick={() => void perform('start', () => openCapture(row.id))}>抓捕追回</button>
          </> : <p>可用嫌疑人不足，本次不可抓捕。</p>)}
        </article>)}
        {loading && <p role="status">记录加载中…</p>}
        {recordError && <p role="alert">{recordError} <button onClick={() => void loadRecords()}>重试</button></p>}
        {list && !rows.length && !loading && <p>还没有记录。</p>}
        {list?.nextCursor && <button disabled={loading} onClick={() => void loadRecords(list.nextCursor!)}>加载更多</button>}
      </section>}
    </div>
  </main>
}
