'use client'

import { useEffect, useRef, useState } from 'react'

type Challenge = {
  challengeId: string
  targetDate: string
  status: 'PENDING' | 'CORRECT' | 'WRONG'
  options: Array<{ id: string; label: string }>
  audio: { url: string; durationSeconds: number }
  correctAnswer?: string | null
  madeUp?: boolean
}

export function CheckInMakeupDialog({
  targetDate,
  monthlyChallengeAvailable,
  monthlyChallengePending,
  currentBalance,
  cost,
  onClose,
  onCompleted,
}: Readonly<{
  targetDate: string
  monthlyChallengeAvailable: boolean
  monthlyChallengePending: boolean
  currentBalance: number
  cost: number
  onClose: () => void
  onCompleted: () => void
}>) {
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [result, setResult] = useState<{ status: 'CORRECT' | 'WRONG'; correctAnswer: string; madeUp: boolean; settlementError?: string } | null>(null)
  const [confirmPaid, setConfirmPaid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [balance, setBalance] = useState(currentBalance)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => () => { audioRef.current?.pause() }, [])

  async function startChallenge() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/checkin/makeup/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetDate }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || '挑战创建失败')
      setChallenge(data.challenge)
      if (data.challenge.status !== 'PENDING') setResult({ status: data.challenge.status, correctAnswer: data.challenge.correctAnswer || '', madeUp: Boolean(data.challenge.madeUp) })
    } catch (error) { setMessage(error instanceof Error ? error.message : '挑战创建失败') } finally { setBusy(false) }
  }

  async function playIntro() {
    if (!challenge) return
    audioRef.current?.pause()
    window.dispatchEvent(new Event('easmusic:pause-all'))
    const audio = new Audio(challenge.audio.url)
    audioRef.current = audio
    audio.currentTime = 0
    const stopAtLimit = () => {
      if (audio.currentTime >= challenge.audio.durationSeconds) { audio.pause(); audio.currentTime = challenge.audio.durationSeconds }
    }
    audio.addEventListener('timeupdate', stopAtLimit)
    try { await audio.play() } catch { setMessage('音频播放失败，请再次点击播放或检查浏览器声音权限') }
  }

  async function submitAnswer() {
    if (!challenge || !selectedOptionId) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/checkin/makeup/challenge/${challenge.challengeId}/answer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectedOptionId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || '答案提交失败')
      audioRef.current?.pause()
      setResult(data)
      if (data.madeUp) { window.dispatchEvent(new Event('checkin:completed')); onCompleted() }
    } catch (error) { setMessage(error instanceof Error ? error.message : '答案提交失败') } finally { setBusy(false) }
  }

  async function pay() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/checkin/makeup/paid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetDate }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || '补签失败')
      if (typeof data.balance === 'number') setBalance(data.balance)
      setMessage(`已补签 ${targetDate.slice(5).replace('-', '月')}日`)
      window.dispatchEvent(new Event('checkin:completed'))
      onCompleted()
    } catch (error) { setMessage(error instanceof Error ? error.message : '补签失败') } finally { setBusy(false) }
  }

  const dateLabel = targetDate.slice(5).replace('-', '月') + '日'
  return (
    <div className="checkin-history-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <article className="checkin-history-detail" role="dialog" aria-modal="true" aria-labelledby="makeup-title">
        <header><div><h2 id="makeup-title">补签 {dateLabel}</h2></div><button type="button" className="checkin-history-close" onClick={onClose} aria-label="关闭补签">×</button></header>
        <div className="checkin-history-detail-body space-y-4">
          {result?.status === 'CORRECT' && result.madeUp ? <div><h3 className="text-xl font-black text-emerald-700">回答正确！</h3><p>本次补挂号免费。已补签 {dateLabel}。</p></div> : null}
          {result?.status === 'CORRECT' && !result.madeUp ? <div><h3 className="text-xl font-black">回答正确</h3><p>{result.settlementError || '该日期已无法完成补签，本月挑战资格已使用。'}</p></div> : null}
          {result?.status === 'WRONG' ? <div className="space-y-2"><h3 className="text-xl font-black text-rose-700">回答错误</h3><p>正确答案：{result.correctAnswer}</p><p>本月免费补签挑战已使用。仍可使用 {cost} 挂号费完成本次补签。</p><button type="button" className="min-h-11 bg-brand-700 px-4 font-black text-white" onClick={() => setConfirmPaid(true)}>使用{cost}挂号费补签</button><button type="button" className="ml-2 min-h-11 border border-slate-300 px-4 font-black" onClick={onClose}>暂不补签</button></div> : null}
          {!result && challenge?.status === 'PENDING' ? <div className="space-y-4"><p className="font-black">免费补挂号挑战</p><p>听 {challenge.audio.durationSeconds} 秒前奏，猜猜这是哪首歌？</p><button type="button" className="min-h-11 bg-brand-950 px-4 font-black text-white" onClick={() => void playIntro()}>播放10秒前奏</button><div className="grid gap-2">{challenge.options.map((option) => <label key={option.id} className="flex min-h-11 items-center gap-3 border border-slate-200 px-3"><input type="radio" name="makeup-answer" value={option.id} checked={selectedOptionId === option.id} onChange={() => setSelectedOptionId(option.id)} /><span>{option.label}</span></label>)}</div><button type="button" className="min-h-11 bg-brand-700 px-4 font-black text-white disabled:opacity-50" disabled={busy || !selectedOptionId} onClick={() => void submitAnswer()}>确认答案</button></div> : null}
          {!result && !challenge && !confirmPaid ? <div className="space-y-4"><p>补签计入连续挂号，但不会补发当天普通签到奖励。每周最多补签 1 次。</p>{monthlyChallengeAvailable || monthlyChallengePending ? <div className="border border-sky-200 bg-sky-50 p-3"><p className="font-black">本月还有一次免费补挂号机会</p><p>听10秒前奏，答对即可免费补签；答错仍可使用{cost}挂号费完成补签。每月仅一次。</p><button type="button" className="mt-3 min-h-11 bg-brand-700 px-4 font-black text-white" disabled={busy} onClick={() => void startChallenge()}>开始免费挑战</button></div> : <p className="font-bold text-slate-600">本月免费挑战已使用。</p>}<button type="button" className="min-h-11 border border-brand-700 px-4 font-black text-brand-800" onClick={() => setConfirmPaid(true)}>直接使用{cost}挂号费补签</button></div> : null}
          {confirmPaid && !result?.madeUp ? <div className="space-y-3 border border-amber-200 bg-amber-50 p-3"><p>将消耗 {cost} 挂号费。当前挂号费：{balance}</p><p>补签计入连续挂号，但不会补发当天原本的普通签到奖励。</p>{balance < cost ? <p className="font-black text-rose-700">挂号费不足：补签需要 {cost}，当前余额 {balance}。</p> : <button type="button" className="min-h-11 bg-brand-950 px-4 font-black text-white" disabled={busy} onClick={() => void pay()}>确认补签 · {cost}挂号费</button>}</div> : null}
          {message ? <p role="status" className="border border-sky-100 bg-sky-50 p-3 font-bold">{message}</p> : null}
        </div>
      </article>
    </div>
  )
}
