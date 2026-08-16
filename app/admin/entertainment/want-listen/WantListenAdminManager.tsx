'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { Pagination } from '@/components/ui/Pagination'

type Config = { enabled: boolean; wantListenEnabled: boolean; cantoneseFragmentEnabled: boolean; falseTitleEnabled: boolean }
type Stats = { todayParticipants: number; todayCompletedGames: number; todayByMode: Record<string, number>; averageAccuracyByMode: Record<string, number>; historicalCompletedGames: number }
type FakeRow = { id: string; title: string; difficulty: 'EASY' | 'NORMAL' | 'HARD'; enabled: boolean; usageCount: number; conflict: boolean; createdAt: string; updatedAt: string }

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '请求失败，请稍后重试。')
  return payload.data
}

const difficultyLabel = { EASY: '简单', NORMAL: '普通', HARD: '困难' } as const

export function WantListenAdminManager() {
  const [config, setConfig] = useState<Config | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [rows, setRows] = useState<FakeRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [form, setForm] = useState({ title: '', difficulty: 'NORMAL' as FakeRow['difficulty'], enabled: true })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    request<{ config: Config; stats: Stats }>('/api/admin/entertainment/want-listen/config')
      .then((data) => { setConfig(data.config); setStats(data.stats) })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '配置加载失败。'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' })
      if (query.trim()) params.set('q', query.trim())
      if (difficulty) params.set('difficulty', difficulty)
      request<{ rows: FakeRow[]; total: number; totalPages: number }>(`/api/admin/entertainment/want-listen/fake-titles?${params}`)
        .then((data) => { setRows(data.rows); setTotal(data.total); setTotalPages(data.totalPages) })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '假歌名加载失败。'))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [page, query, difficulty])

  async function saveConfig(key: keyof Config, value: boolean) {
    if (!config) return
    const next = { ...config, [key]: value }
    setConfig(next)
    try {
      await request('/api/admin/entertainment/want-listen/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      setMessage('想听设置已保存。')
    } catch (reason) {
      setConfig(config)
      setError(reason instanceof Error ? reason.message : '设置保存失败。')
    }
  }

  async function saveFakeTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const data = await request<{ row: FakeRow }>(editingId ? `/api/admin/entertainment/want-listen/fake-titles/${editingId}` : '/api/admin/entertainment/want-listen/fake-titles', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (editingId) setRows((current) => current.map((row) => row.id === editingId ? data.row : row))
      else { setRows((current) => [data.row, ...current]); setTotal((value) => value + 1) }
      setMessage(editingId ? '假歌名已更新。' : '假歌名已新增。')
      setEditingId(null)
      setForm({ title: '', difficulty: 'NORMAL', enabled: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '假歌名保存失败。')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(row: FakeRow) {
    try {
      const data = await request<{ row: FakeRow }>(`/api/admin/entertainment/want-listen/fake-titles/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !row.enabled }) })
      setRows((current) => current.map((item) => item.id === row.id ? data.row : item))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '假歌名状态更新失败。')
    }
  }

  async function remove(row: FakeRow) {
    if (!window.confirm(`确认删除「${row.title}」？`)) return
    try {
      await request(`/api/admin/entertainment/want-listen/fake-titles/${row.id}`, { method: 'DELETE' })
      setRows((current) => current.filter((item) => item.id !== row.id))
      setTotal((value) => Math.max(0, value - 1))
      setMessage('假歌名已删除。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '假歌名删除失败。')
    }
  }

  return (
    <main className="want-listen-admin-page admin-mobile-page mx-auto max-w-7xl space-y-5 px-4 py-7 sm:px-5">
      <header className="border-b border-sky-100 pb-5"><Link href="/admin" className="text-sm font-black text-brand-700">← 返回后台</Link><p className="mt-5 text-xs font-black tracking-[0.2em] text-brand-700">SILENT MUSIC QUIZ ADMIN</p><h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">想听</h1><p className="mt-2 text-sm font-bold text-slate-500">管理板块开关、假歌名题库和基础运行数据。正式题目始终从 EasMusic 实时生成。</p></header>
      {message ? <p role="status" className="bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}
      <section className="border border-sky-100 bg-white/95 p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-brand-950">基础设置</h2><p className="mt-1 text-sm font-bold text-slate-500">关闭后前台不能开始新局，后台仍可维护题库。</p></div>{loading ? <span className="text-xs font-bold text-slate-400">加载中…</span> : null}</div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([['enabled', '想听板块'], ['wantListenEnabled', '想听模式'], ['cantoneseFragmentEnabled', '粤语残片'], ['falseTitleEnabled', '防不胜防']] as const).map(([key, label]) => <label key={key} className="flex items-start gap-3 border border-sky-100 bg-sky-50/50 p-4"><input type="checkbox" checked={Boolean(config?.[key])} onChange={(event) => void saveConfig(key, event.target.checked)} className="mt-1 size-4" /><span><strong className="block text-sm font-black text-brand-950">{label}</strong><small className="mt-1 block text-xs font-bold text-slate-500">{config?.[key] ? '已启用' : '已停用'}</small></span></label>)}</div></section>
      <section className="border border-sky-100 bg-white/95 p-5 shadow-sm sm:p-6"><h2 className="text-xl font-black text-brand-950">数据概览</h2><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">今日参与人数</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats?.todayParticipants || 0}</strong></div><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">今日完成局数</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats?.todayCompletedGames || 0}</strong></div><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">历史完成局数</span><strong className="mt-2 block text-2xl font-black text-brand-950">{stats?.historicalCompletedGames || 0}</strong></div><div className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">今日三模式</span><strong className="mt-2 block text-sm font-black text-brand-950">{stats?.todayByMode.WANT_LISTEN || 0} / {stats?.todayByMode.CANTONESE_FRAGMENT || 0} / {stats?.todayByMode.FALSE_TITLE || 0}</strong></div></div><div className="mt-4 grid gap-2 text-sm font-bold text-slate-600 sm:grid-cols-3"><p>想听平均正确率：{stats?.averageAccuracyByMode.WANT_LISTEN || 0}%</p><p>粤语残片平均正确率：{stats?.averageAccuracyByMode.CANTONESE_FRAGMENT || 0}%</p><p>防不胜防平均正确率：{stats?.averageAccuracyByMode.FALSE_TITLE || 0}%</p></div></section>
      <section className="border border-sky-100 bg-white/95 p-5 shadow-sm sm:p-6"><div><h2 className="text-xl font-black text-brand-950">假歌名库</h2><p className="mt-1 text-sm font-bold text-slate-500">保存时会和已发布 EasMusic 真实歌名做标准化冲突检查；冲突项不会进入题池。</p></div><form onSubmit={saveFakeTitle} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto]" id="fake-title-form"><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="border border-sky-100 px-3 py-3 text-sm font-bold outline-none focus:border-brand-400" placeholder="输入假歌名" /><select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value as FakeRow['difficulty'] })} className="border border-sky-100 px-3 py-3 text-sm font-bold"><option value="EASY">简单</option><option value="NORMAL">普通</option><option value="HARD">困难</option></select><button disabled={busy} className="bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : editingId ? '保存编辑' : '新增假歌名'}</button></form>{editingId ? <button type="button" onClick={() => { setEditingId(null); setForm({ title: '', difficulty: 'NORMAL', enabled: true }) }} className="mt-2 text-xs font-black text-brand-700">取消编辑</button> : null}<div className="mt-5 flex flex-wrap gap-2"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} className="border border-sky-100 px-3 py-2 text-sm font-bold" placeholder="搜索歌名" /><select value={difficulty} onChange={(event) => { setDifficulty(event.target.value); setPage(1) }} className="border border-sky-100 px-3 py-2 text-sm font-bold"><option value="">全部难度</option><option value="EASY">简单</option><option value="NORMAL">普通</option><option value="HARD">困难</option></select><span className="self-center text-xs font-bold text-slate-500">共 {total} 条</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-sky-100 text-xs font-black text-slate-500"><tr><th className="p-3">歌名</th><th className="p-3">难度</th><th className="p-3">状态</th><th className="p-3">使用次数</th><th className="p-3">冲突</th><th className="p-3">操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-sky-50 last:border-0"><td className="break-words p-3 font-black text-brand-950">{row.title}</td><td className="p-3"><span className="bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{difficultyLabel[row.difficulty]}</span></td><td className="p-3 text-xs font-black">{row.enabled ? <span className="text-emerald-700">启用</span> : <span className="text-slate-400">停用</span>}</td><td className="p-3 font-bold text-slate-600">{row.usageCount}</td><td className="p-3 text-xs font-black">{row.conflict ? <span className="text-red-600">与真实曲库冲突</span> : <span className="text-emerald-700">正常</span>}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void toggle(row)} className="bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">{row.enabled ? '停用' : '启用'}</button><button type="button" onClick={() => { setEditingId(row.id); setForm({ title: row.title, difficulty: row.difficulty, enabled: row.enabled }); document.getElementById('fake-title-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} className="bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">编辑</button><button type="button" onClick={() => void remove(row)} className="bg-red-50 px-3 py-2 text-xs font-black text-red-600">删除</button></div></td></tr>)}</tbody></table>{!rows.length ? <p className="p-6 text-center text-sm font-bold text-slate-500">当前没有假歌名。</p> : null}</div><Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} ariaLabel="假歌名分页" /></section>
    </main>
  )
}
