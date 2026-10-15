'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TopicActivityV2Poll, TopicActivityV2PublicProgram } from '@/lib/topic-activity-v2-config'

const buttonClass = 'min-h-10 rounded-sm border border-[var(--border)] px-4 text-sm font-bold disabled:opacity-40'
type PollPayload = { poll: TopicActivityV2Poll; myChoices: string[]; results: { participantCount: number; options: { id: string; label: string; count: number; percentage: number }[] } | null }
type ResultSnapshot = { title: string; description: string; score: number | null; maxScore: number | null; testTitle: string }
type Attempt = { id: string; resultSnapshot: ResultSnapshot; completedAt: string }
type PublicTest = TopicActivityV2PublicProgram['test']

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' })
  const body = await response.json().catch(() => null) as T & { message?: string }
  if (!response.ok) throw new Error(body?.message || (response.status === 401 ? '请登录后参与' : '操作失败，请重试'))
  return body
}

export function TopicActivityV2PollPanel({ activityId, isAuthenticated }: { activityId: string; isAuthenticated: boolean }) {
  const [payload, setPayload] = useState<PollPayload | null>(null)
  const [choices, setChoices] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const url = '/api/activities/' + encodeURIComponent(activityId) + '/v2/poll'
  const load = useCallback(async () => {
    try { const value = await requestJson<PollPayload>(url); setPayload(value); setChoices(Array.isArray(value.myChoices) ? value.myChoices : []); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '投票加载失败') }
  }, [url])
  useEffect(() => { void load() }, [load])
  async function submit() {
    if (busy.current || !choices.length) return
    busy.current = true; setPending(true); setError('')
    try { await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choices }) }); await load(); window.dispatchEvent(new Event('topic-activity-v2-changed')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '投票失败') }
    finally { busy.current = false; setPending(false) }
  }
  if (!payload) return <div role={error ? 'alert' : 'status'}>{error || '正在加载投票…'}{error ? <button type="button" onClick={() => void load()} className={buttonClass}>重试</button> : null}</div>
  const voted = payload.myChoices.length > 0
  return <section aria-label="活动投票" className="space-y-3 border-t border-[var(--border)] pt-4">
    <h3 className="text-lg font-bold">{payload.poll.title}</h3><p className="whitespace-pre-wrap text-sm">{payload.poll.description}</p>
    {payload.poll.options.map((option) => <label key={option.id} className="flex min-h-10 items-center gap-3 border border-[var(--border)] p-3 text-sm"><input type={payload.poll.mode === 'MULTI' ? 'checkbox' : 'radio'} name={'poll-' + payload.poll.id} checked={choices.includes(option.id)} disabled={!isAuthenticated || pending || (voted && !payload.poll.allowChange)} onChange={() => {
      if (payload.poll.mode === 'SINGLE') setChoices([option.id])
      else if (choices.includes(option.id)) setChoices(choices.filter((id) => id !== option.id))
      else if (choices.length < payload.poll.maxChoices) setChoices([...choices, option.id])
    }} />{option.label}</label>)}
    <p className="text-xs text-[var(--foreground-muted)]">{payload.poll.mode === 'MULTI' ? '最多选择 ' + payload.poll.maxChoices + ' 项。' : '请选择一项。'}{voted ? '你已投票。' : ''}</p>
    {isAuthenticated ? <button type="button" onClick={() => void submit()} disabled={pending || !choices.length || (voted && !payload.poll.allowChange)} className={buttonClass}>{pending ? '提交中…' : voted ? '确认修改投票' : '确认投票'}</button> : <Link href="/login" className="text-sm underline">登录后投票</Link>}
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    {payload.results ? <div className="space-y-2 text-sm"><p>参与人数：{payload.results.participantCount}</p>{payload.results.options.map((option) => <div key={option.id}><p>{option.label}：{option.count} 票 · {option.percentage}%</p><progress className="w-full" max={100} value={option.percentage} /></div>)}<p className="text-xs text-[var(--foreground-muted)]">占比按参与人数计算；多选投票各项占比之和可能超过 100%。</p></div> : <p className="text-xs text-[var(--foreground-muted)]">当前未开放投票结果。</p>}
  </section>
}

export function TopicActivityV2TestRunner({ activityId, isAuthenticated }: { activityId: string; isAuthenticated: boolean }) {
  const searchParams = useSearchParams()
  const requestedAttemptId = searchParams.get('attemptId')
  const [test, setTest] = useState<PublicTest | null>(null)
  const [activityTitle, setActivityTitle] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [history, setHistory] = useState<Attempt[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [posterBlob, setPosterBlob] = useState<Blob | null>(null)
  const busy = useRef(false), requestKey = useRef<string | null>(null)
  const base = '/api/activities/' + encodeURIComponent(activityId) + '/v2'
  const load = useCallback(async () => {
    try {
      const value = await requestJson<{ activity: { title: string }; test: PublicTest }>(base + '/test')
      setTest(value.test); setActivityTitle(value.activity.title); setError('')
      if (isAuthenticated) {
        const attempts = (await requestJson<{ attempts: Attempt[] }>(base + '/attempts')).attempts
        setHistory(attempts)
        const selected = requestedAttemptId ? attempts.find((item) => item.id === requestedAttemptId) : null
        if (selected) { setAttempt(selected); setPosterUrl(null); setPosterBlob(null); requestKey.current = null }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '测试加载失败') }
  }, [base, isAuthenticated, requestedAttemptId])
  useEffect(() => { void load() }, [load])
  useEffect(() => () => { if (posterUrl) URL.revokeObjectURL(posterUrl) }, [posterUrl])
  function showAttempt(value: Attempt | null) { setAttempt(value); setPosterUrl(null); setPosterBlob(null) }
  async function submit() {
    if (busy.current || !test || test.questions.some((question) => !answers[question.id])) return
    busy.current = true; setPending(true); setError('')
    if (!requestKey.current) requestKey.current = crypto.randomUUID()
    try {
      const value = await requestJson<{ attempt: Attempt }>(base + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, requestKey: requestKey.current }) })
      showAttempt(value.attempt); setHistory((await requestJson<{ attempts: Attempt[] }>(base + '/attempts')).attempts)
      window.dispatchEvent(new Event('topic-activity-v2-changed'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '测试提交失败') }
    finally { busy.current = false; setPending(false) }
  }
  async function poster() {
    if (!attempt || busy.current) return
    busy.current = true; setPending(true); setError('')
    try {
      const response = await fetch(base + '/attempts/' + encodeURIComponent(attempt.id) + '/poster', { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) { const value = await response.json().catch(() => null); throw new Error(value?.message || '海报生成失败，请重试') }
      const blob = await response.blob(); setPosterBlob(blob); setPosterUrl(URL.createObjectURL(blob))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '海报生成失败') }
    finally { busy.current = false; setPending(false) }
  }
  async function share() {
    if (!posterBlob) return
    const file = new File([posterBlob], 'ecfc-activity-result.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: attempt?.resultSnapshot.title, files: [file] }) }
      catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError('请保存图片后分享到平台。') }
    } else setError('当前浏览器请长按海报或点击保存 PNG，再分享到平台。')
  }
  const question = test?.questions[index]
  return <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
    <Link href={'/activities/' + encodeURIComponent(activityId)} className="text-sm underline">← 返回活动</Link><p className="text-sm text-[var(--foreground-muted)]">{activityTitle}</p><h1 className="text-2xl font-bold">{test?.title || '活动测试'}</h1>
    {error ? <p role="alert" className="text-red-600">{error}<button type="button" onClick={() => void load()} className={buttonClass}>重试加载</button></p> : null}
    {!test && !error ? <p>正在加载测试…</p> : null}
    {attempt ? <section className="space-y-4 border border-[var(--border)] p-4"><h2 className="text-xl font-bold">{attempt.resultSnapshot.title}</h2><p className="whitespace-pre-wrap">{attempt.resultSnapshot.description}</p>{typeof attempt.resultSnapshot.score === 'number' ? <p>得分：{attempt.resultSnapshot.score} / {attempt.resultSnapshot.maxScore}</p> : null}
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void poster()} disabled={pending} className={buttonClass}>{pending ? '生成中…' : '生成结果海报'}</button>{posterUrl ? <><a href={posterUrl} download="ecfc-activity-result.png" className={buttonClass}>保存 PNG</a><button type="button" onClick={() => void share()} className={buttonClass}>分享结果图片</button></> : null}{test?.allowRetake ? <button type="button" onClick={() => { showAttempt(null); setAnswers({}); setIndex(0); requestKey.current = null }} className={buttonClass}>重新测试</button> : null}</div>
      {posterUrl ? <div className="space-y-2"><p className="text-sm">微信内可长按图片保存。</p>{/* Blob is an authenticated generated PNG; native img enables WeChat long-press saving. */}<img src={posterUrl} alt="我的测试结果海报" className="aspect-[9/16] h-auto w-full max-w-md object-contain" /></div> : null}
      <p className="text-sm">保存海报后，可返回活动选择平台任务，主动分享并提交截图。</p>
    </section> : question ? <section className="space-y-4 border border-[var(--border)] p-4"><p>第 {index + 1} / {test!.questions.length} 题</p><progress max={test!.questions.length} value={index + 1} className="w-full" /><h2 className="text-lg font-bold">{question.prompt}</h2>{question.options.map((option) => <label key={option.id} className="flex min-h-12 items-center gap-3 border border-[var(--border)] p-3"><input type="radio" name={question.id} checked={answers[question.id] === option.id} disabled={pending || !isAuthenticated} onChange={() => setAnswers({ ...answers, [question.id]: option.id })} />{option.label}</label>)}<div className="flex gap-2"><button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0 || pending} className={buttonClass}>上一题</button>{index < test!.questions.length - 1 ? <button type="button" onClick={() => setIndex(index + 1)} disabled={!answers[question.id] || pending} className={buttonClass}>下一题</button> : <button type="button" onClick={() => void submit()} disabled={!isAuthenticated || pending || test!.questions.some((item) => !answers[item.id])} className={buttonClass}>{pending ? '提交中…' : '提交测试'}</button>}</div>{!isAuthenticated ? <Link href="/login" className="underline">请先登录后测试</Link> : null}</section> : null}
    {history.length ? <section className="space-y-2 border-t border-[var(--border)] pt-4"><h2 className="font-bold">我的历史结果</h2>{history.map((item) => <button type="button" key={item.id} onClick={() => showAttempt(item)} className="block text-left text-sm underline">{item.resultSnapshot.title} · {new Date(item.completedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</button>)}</section> : null}
  </main>
}
