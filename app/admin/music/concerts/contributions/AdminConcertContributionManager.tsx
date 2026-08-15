'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
type Type = 'SHOW' | 'SETLIST' | 'ENCORE'
type Contribution = {
  id: string
  type: Type
  typeLabel: string
  status: Status
  statusLabel: string
  payload: unknown
  targetShowId: string | null
  reviewNote: string | null
  createdAt: string
  submitter: { uid: number; username: string; nickname: string; displayName: string; avatarUrl: string | null }
  targetShow: { city: string; concertDate: string; venue: string | null; title: string | null; MusicTour: { name: string } } | null
}
type Detail = Contribution & {
  duplicateShows: Array<{ id: string; city: string; concertDate: string; venue: string | null; title: string | null; MusicTour: { name: string } }>
  hasFormalSetlist: boolean
  hasFormalEncore: boolean
  reviewer: { uid: number; username: string } | null
}

const field = 'w-full border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-brand-950 outline-none focus:border-brand-400'

function dateText(value: string | null | undefined) { return value ? value.slice(0, 10) : '' }
function showSummary(item: Contribution) {
  if (item.targetShow) return `${item.targetShow.MusicTour.name} · ${item.targetShow.city} · ${dateText(item.targetShow.concertDate)}`
  if (item.payload && typeof item.payload === 'object' && 'city' in item.payload) {
    const payload = item.payload as { city?: string; concertDate?: string }
    return `${payload.city || '未填写城市'} · ${payload.concertDate || '未填写日期'}`
  }
  return '待绑定场次'
}

export function AdminConcertContributionManager() {
  const [status, setStatus] = useState<Status>('PENDING')
  const [type, setType] = useState('')
  const [items, setItems] = useState<Contribution[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [payloadText, setPayloadText] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState<Detail['duplicateShows']>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadList() {
    const params = new URLSearchParams({ status })
    if (type) params.set('type', type)
    const response = await fetch(`/api/admin/music/concerts/contributions?${params}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null)
    if (response.ok) setItems(data?.contributions || [])
  }
  async function loadDetail(id: string) {
    setError(''); setMessage('')
    const response = await fetch(`/api/admin/music/concerts/contributions/${id}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null)
    if (!response.ok) return setError(data?.message || '投稿详情加载失败')
    const item = data.contribution as Detail
    setDetail(item); setPayloadText(JSON.stringify(item.payload, null, 2)); setReviewNote(item.reviewNote || ''); setDuplicateWarning(item.duplicateShows || [])
  }
  useEffect(() => { void loadList() }, [status, type])

  function parsePayload() {
    try { return JSON.parse(payloadText) as unknown } catch { setError('投稿内容 JSON 格式无效，请检查括号和逗号'); return null }
  }
  async function save() {
    if (!detail) return
    const payload = parsePayload()
    if (!payload) return
    setBusy(true); setError(''); setMessage('')
    const response = await fetch(`/api/admin/music/concerts/contributions/${detail.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '保存失败')
    else { setMessage(data?.message || '审核内容已保存'); await loadDetail(detail.id); await loadList() }
    setBusy(false)
  }
  async function approve(allowDuplicate = false) {
    if (!detail) return
    const payload = parsePayload()
    if (!payload) return
    setBusy(true); setError(''); setMessage('')
    const response = await fetch(`/api/admin/music/concerts/contributions/${detail.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, allowDuplicate }) })
    const data = await response.json().catch(() => null)
    if (response.status === 409 && data?.code === 'POSSIBLE_DUPLICATE') { setDuplicateWarning(data.duplicates || []); setError(data.message || '检测到疑似重复场次'); setBusy(false); return }
    if (!response.ok) setError(data?.message || '审核通过失败')
    else { setMessage(data?.message || '投稿已审核通过'); setDetail(null); await loadList() }
    setBusy(false)
  }
  async function reject() {
    if (!detail) return
    if (!reviewNote.trim()) return setError('拒绝投稿时必须填写拒绝原因')
    setBusy(true); setError(''); setMessage('')
    const response = await fetch(`/api/admin/music/concerts/contributions/${detail.id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewNote }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) setError(data?.message || '拒绝失败')
    else { setMessage(data?.message || '投稿已拒绝'); setDetail(null); await loadList() }
    setBusy(false)
  }

  return <main className="admin-mobile-page mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5"><section className="border border-sky-100 bg-white/95 p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4"><div><Link href="/admin/music/concerts" className="text-sm font-black text-brand-700">← 演唱会场次管理</Link><h1 className="mt-4 text-4xl font-black text-brand-950">用户投稿</h1><p className="mt-2 text-sm font-bold text-slate-500">管理员可在审核内容编辑器中修正正式字段、歌曲顺序和 Encore，再发布到现有资料体系。</p></div><div className="flex flex-wrap gap-2">{(['PENDING', 'APPROVED', 'REJECTED'] as const).map((value) => <button key={value} type="button" onClick={() => { setStatus(value); setDetail(null) }} className={`px-3 py-2 text-sm font-black ${status === value ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{value === 'PENDING' ? '待审核' : value === 'APPROVED' ? '已通过' : '已拒绝'}</button>)}</div></div><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => setType('')} className={`px-3 py-2 text-xs font-black ${!type ? 'bg-sky-200 text-brand-950' : 'bg-sky-50 text-brand-700'}`}>全部类型</button>{(['SHOW', 'SETLIST', 'ENCORE'] as const).map((value) => <button type="button" key={value} onClick={() => setType(value)} className={`px-3 py-2 text-xs font-black ${type === value ? 'bg-sky-200 text-brand-950' : 'bg-sky-50 text-brand-700'}`}>{value === 'SHOW' ? '场次' : value === 'SETLIST' ? '歌单' : 'Encore'}</button>)}</div></section>{message ? <p role="status" className="bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}{error ? <p role="alert" className="bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}<div className="grid gap-6 lg:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.5fr)]"><section className="space-y-3">{items.map((item) => <button type="button" key={item.id} onClick={() => void loadDetail(item.id)} className={`block w-full border p-4 text-left ${detail?.id === item.id ? 'border-brand-500 bg-sky-50' : 'border-sky-100 bg-white/90'}`}><div className="flex gap-3"><div className="size-10 shrink-0 overflow-hidden bg-brand-950">{item.submitter.avatarUrl ? <img src={item.submitter.avatarUrl} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-xs font-black text-white">{String(item.submitter.uid).slice(-1)}</span>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><strong className="break-words text-sm text-brand-950">{item.submitter.displayName} · UID {item.submitter.uid}</strong><span className="text-xs font-black text-brand-700">{item.typeLabel}</span></div><p className="mt-2 break-words text-sm font-bold text-slate-600">{showSummary(item)}</p><p className="mt-1 text-xs font-bold text-slate-400">{item.createdAt.slice(0, 16).replace('T', ' ')}</p></div></div></button>)}{!items.length ? <p className="border border-sky-100 bg-white/90 p-6 text-sm font-bold text-slate-500">当前没有投稿。</p> : null}</section><section>{detail ? <section className="border border-sky-100 bg-white/95 p-5 shadow-sm sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black tracking-[0.18em] text-brand-600">{detail.typeLabel}</p><h2 className="mt-2 break-words text-2xl font-black text-brand-950">{detail.submitter.displayName} · UID {detail.submitter.uid}</h2><p className="mt-1 text-sm font-bold text-slate-500">用户名：{detail.submitter.username} · 投稿于 {detail.createdAt.slice(0, 16).replace('T', ' ')}</p></div><span className="bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{detail.statusLabel}</span></div>{duplicateWarning.length ? <div className="mt-5 border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900"><p>该场次可能与现有正式场次重复，请确认后再审核通过。</p><p className="mt-2 text-xs">{duplicateWarning.map((row) => `${row.MusicTour.name} · ${row.city} · ${dateText(row.concertDate)}${row.venue ? ` · ${row.venue}` : ''}`).join('；')}</p></div> : null}{detail.type === 'SETLIST' && detail.hasFormalSetlist ? <p className="mt-4 border border-amber-200 bg-amber-50 p-3 text-sm font-black text-amber-900">该场次已经存在正式歌单，本次投稿将更新现有歌单。</p> : null}{detail.type === 'ENCORE' && detail.hasFormalEncore ? <p className="mt-4 border border-amber-200 bg-amber-50 p-3 text-sm font-black text-amber-900">该场次已经存在正式 Encore，本次投稿将更新现有 Encore。</p> : null}<label className="mt-6 block text-sm font-black text-brand-950">审核内容（沿用现有正式场次 / 歌单 / Encore 字段）<textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} className={`${field} mt-2 min-h-[360px] font-mono text-xs`} spellCheck={false} /></label><p className="mt-2 text-xs font-bold leading-5 text-slate-500">歌单 `items` 保持正式 `MusicConcertSetlistItem` 字段；调整数组顺序即可调整歌曲顺序，`isEncore: true` 即为 Encore。服务端会再次校验曲库歌曲和场次 ID。</p><label className="mt-5 block text-sm font-black text-brand-950">拒绝原因<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className={`${field} mt-2 min-h-24`} placeholder="拒绝时必填，例如：内容不完整、无法确认真实性" /></label><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={save} disabled={busy || detail.status !== 'PENDING'} className="bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-40">保存审核修改</button><button type="button" onClick={reject} disabled={busy || detail.status !== 'PENDING'} className="bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40">拒绝投稿</button><button type="button" onClick={() => void approve()} disabled={busy || detail.status !== 'PENDING' || Boolean(duplicateWarning.length)} className="bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40">审核通过并发布</button>{duplicateWarning.length ? <button type="button" onClick={() => void approve(true)} disabled={busy || detail.status !== 'PENDING'} className="bg-amber-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">确认重复仍然发布</button> : null}</div></section> : <div className="border border-sky-100 bg-white/90 p-8 text-sm font-bold text-slate-500">选择左侧投稿查看详情。</div>}</section></div></main>
}
