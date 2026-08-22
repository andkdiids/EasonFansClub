'use client'

import { useState } from 'react'

export type BannedWordRow = {
  id: string
  word: string
  normalizedWord: string
  enabled: boolean
  priority: 'NORMAL' | 'HIGH'
  note: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; uid: number; nickname: string } | null
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

export function BannedWordManager({ initialWords }: { initialWords: BannedWordRow[] }) {
  const [words, setWords] = useState(initialWords)
  const [word, setWord] = useState('')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<'NORMAL' | 'HIGH'>('NORMAL')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState(false)

  async function addWord() {
    setAdding(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/banned-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, note, priority }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.word) {
        setMessage(data?.message || '违禁词新增失败')
        return
      }
      setWords((current) => [data.word as BannedWordRow, ...current])
      setWord('')
      setNote('')
      setPriority('NORMAL')
      setMessage('违禁词已新增，历史扫描已开始。')
    } catch {
      setMessage('网络错误，请稍后重试。')
    } finally {
      setAdding(false)
    }
  }

  async function patchWord(row: BannedWordRow, patch: Partial<Pick<BannedWordRow, 'enabled' | 'priority' | 'note'>>) {
    setBusyId(row.id)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/banned-words/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.word) {
        setMessage(data?.message || '违禁词更新失败')
        return
      }
      setWords((current) => current.map((item) => item.id === row.id ? data.word as BannedWordRow : item))
      setMessage('违禁词已更新。')
    } catch {
      setMessage('网络错误，请稍后重试。')
    } finally {
      setBusyId(null)
    }
  }

  async function removeWord(row: BannedWordRow) {
    if (!window.confirm(`确认删除违禁词“${row.word}”？已标记的历史违规内容不会恢复。`)) return
    setBusyId(row.id)
    setMessage('')
    try {
      const response = await fetch(`/api/admin/banned-words/${row.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(data?.message || '违禁词删除失败')
        return
      }
      setWords((current) => current.filter((item) => item.id !== row.id))
      setMessage('违禁词已删除。')
    } catch {
      setMessage('网络错误，请稍后重试。')
    } finally {
      setBusyId(null)
    }
  }

  async function rescan() {
    if (!window.confirm('将根据当前启用的违禁词重新扫描现有用户资料及用户内容，并将命中的内容标记为违规。是否继续？')) return
    setScanning(true)
    setMessage('扫描中...')
    try {
      const response = await fetch('/api/admin/banned-words/rescan', { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.job?.id) {
        setMessage(data?.message || '扫描启动失败')
        return
      }
      const jobId = data.job.id as string
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500))
        const statusResponse = await fetch(`/api/admin/banned-words/rescan?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        const statusData = await statusResponse.json().catch(() => null)
        if (!statusResponse.ok || !statusData?.job) continue
        if (statusData.job.status === 'FAILED') throw new Error(statusData.job.error || '扫描失败')
        if (statusData.job.status === 'COMPLETED') {
          const summary = statusData.job.summary
          setMessage(`扫描完成：登录账号 ${summary.username}，个人简介 ${summary.bio}，帖子 ${summary.posts}，评论 ${summary.comments}，挂号留言 ${summary.checkinMessages}，留言墙 ${summary.wallMessages}，其他 ${summary.other}。`)
          return
        }
      }
      setMessage('扫描仍在后台进行中，请稍后刷新查看结果。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '扫描失败，请稍后重试。')
    } finally {
      setScanning(false)
    }
  }

  return (
    <section className="space-y-6" aria-busy={adding || scanning || Boolean(busyId)}>
      <div className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-brand-950">新增违禁词</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">保存时会清理首尾空格，英文词按大小写不敏感规则去重。</p>
          </div>
          <button type="button" disabled={scanning} onClick={() => void rescan()} className="rounded-full bg-brand-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{scanning ? '扫描中...' : '重新扫描全站'}</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_220px_auto]">
          <input value={word} onChange={(event) => setWord(event.target.value)} maxLength={100} placeholder="违禁词" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-500" />
          <select value={priority} onChange={(event) => setPriority(event.target.value as 'NORMAL' | 'HIGH')} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold">
            <option value="NORMAL">普通等级</option>
            <option value="HIGH">最高优先级</option>
          </select>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="备注（可选）" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold outline-none focus:border-brand-500" />
          <button type="button" disabled={adding || !word.trim()} onClick={() => void addWord()} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{adding ? '保存中...' : '新增'}</button>
        </div>
      </div>

      {message ? <p className="rounded-2xl bg-sky-50 px-4 py-3 text-sm font-bold text-brand-700 ring-1 ring-sky-100">{message}</p> : null}

      <div className="overflow-hidden rounded-[28px] border border-sky-100 bg-white/90 shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_90px_100px_180px_120px] gap-3 border-b border-sky-100 px-5 py-4 text-xs font-black text-slate-500 sm:px-6">
          <span>违禁词</span><span>等级</span><span>状态</span><span>创建时间 / 管理员</span><span>操作</span>
        </div>
        {words.map((row) => (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_90px_100px_180px_120px] items-center gap-3 border-b border-sky-50 px-5 py-4 last:border-b-0 sm:px-6">
            <div className="min-w-0"><p className="break-words text-sm font-black text-brand-950">{row.word}</p><p className="mt-1 break-all text-[11px] font-bold text-slate-400">{row.note || `normalized: ${row.normalizedWord}`}</p></div>
            <span className={`w-fit rounded-full px-2 py-1 text-[11px] font-black ${row.priority === 'HIGH' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{row.priority === 'HIGH' ? '最高' : '普通'}</span>
            <button type="button" disabled={busyId === row.id} onClick={() => void patchWord(row, { enabled: !row.enabled })} className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-black ${row.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.enabled ? '启用' : '停用'}</button>
            <div className="text-[11px] font-bold text-slate-500"><time className="block">{formatDate(row.createdAt)}</time><span>{row.createdBy ? `${row.createdBy.nickname}（UID ${row.createdBy.uid}）` : '系统预置'}</span></div>
            <button type="button" disabled={busyId === row.id} onClick={() => void removeWord(row)} className="w-fit rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50">删除</button>
          </div>
        ))}
        {!words.length ? <p className="px-6 py-12 text-center text-sm font-bold text-slate-400">暂无违禁词</p> : null}
      </div>
    </section>
  )
}
