'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Pagination } from '@/components/ui/Pagination'

type Difficulty = 'EASY' | 'NORMAL' | 'HARD'
type Category = 'SONG' | 'ALBUM' | 'EASON_RELATED' | 'GENERAL'
type Config = { enabled: boolean }
type Overview = { todayParticipants: number; todayCompletedGames: number; historicalCompletedGames: number; enabledWordPairs: number; totalWordPairs: number }
type Row = { id: string; civilianWord: string; undercoverWord: string; category: Category; categoryLabel: string; difficulty: Difficulty; difficultyLabel: string; enabled: boolean; configuredEnabled: boolean; usageCount: number; createdAt: string; updatedAt: string }

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '请求失败，请稍后重试。')
  return payload.data
}

const difficultyLabel: Record<Difficulty, string> = { EASY: '简单', NORMAL: '普通', HARD: '困难' }
const categoryLabel: Record<Category, string> = { SONG: '歌曲', ALBUM: '专辑', EASON_RELATED: 'Eason 相关', GENERAL: '普通' }

export function UndercoverStarAdminManager() {
  const [config, setConfig] = useState<Config | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ civilianWord: '', undercoverWord: '', category: 'GENERAL' as Category, difficulty: 'NORMAL' as Difficulty, enabled: true })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadConfig() {
    const data = await request<{ config: Config; overview: Overview }>('/api/admin/entertainment/undercover-star/config')
    setConfig(data.config)
    setOverview(data.overview)
  }

  const loadRows = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (query.trim()) params.set('q', query.trim())
    if (category) params.set('category', category)
    if (difficulty) params.set('difficulty', difficulty)
    const data = await request<{ rows: Row[]; total: number; totalPages: number }>(`/api/admin/entertainment/undercover-star/word-pairs?${params}`)
    setRows(data.rows)
    setTotal(data.total)
    setTotalPages(data.totalPages)
  }, [category, difficulty, page, query])

  useEffect(() => { void loadConfig().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '设置加载失败。')) }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRows().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '词库加载失败。')) }, 160)
    return () => window.clearTimeout(timer)
  }, [loadRows])

  async function toggleEnabled() {
    if (!config) return
    const next = { enabled: !config.enabled }
    setConfig(next)
    try {
      const data = await request<{ config: Config; overview: Overview }>('/api/admin/entertainment/undercover-star/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      setConfig(data.config)
      setOverview(data.overview)
      setMessage(data.config.enabled ? '卧底巨星已启用。' : '卧底巨星已停用，新房间不会再创建。')
    } catch (reason) {
      setConfig(config)
      setError(reason instanceof Error ? reason.message : '设置保存失败。')
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const url = editingId ? `/api/admin/entertainment/undercover-star/word-pairs/${editingId}` : '/api/admin/entertainment/undercover-star/word-pairs'
      const data = await request<{ row: Row }>(url, { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (editingId) setRows((current) => current.map((row) => row.id === editingId ? data.row : row))
      else { setRows((current) => [data.row, ...current]); setTotal((value) => value + 1) }
      setEditingId(null)
      setForm({ civilianWord: '', undercoverWord: '', category: 'GENERAL', difficulty: 'NORMAL', enabled: true })
      setMessage(editingId ? '词组已更新。' : '词组已新增。')
      void loadConfig()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '词组保存失败。')
    } finally {
      setBusy(false)
    }
  }

  async function toggleRow(row: Row) {
    try {
      const data = await request<{ row: Row }>(`/api/admin/entertainment/undercover-star/word-pairs/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !row.configuredEnabled }) })
      setRows((current) => current.map((item) => item.id === row.id ? data.row : item))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '状态更新失败。') }
  }

  async function remove(row: Row) {
    if (!window.confirm(`确认删除“${row.civilianWord} / ${row.undercoverWord}”？`)) return
    try {
      await request(`/api/admin/entertainment/undercover-star/word-pairs/${row.id}`, { method: 'DELETE' })
      setRows((current) => current.filter((item) => item.id !== row.id))
      setTotal((value) => Math.max(0, value - 1))
      setMessage('词组已删除。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '词组删除失败。') }
  }

  return (
    <main className="undercover-admin-page admin-mobile-page mx-auto max-w-7xl space-y-5 px-4 py-7 sm:px-5">
      <header className="border-b border-sky-100 pb-5"><Link href="/admin" className="text-sm font-black text-brand-700">← 返回后台</Link><p className="mt-5 text-xs font-black tracking-[0.2em] text-brand-700">UNDERCOVER STAR ADMIN</p><h1 className="mt-2 text-3xl font-black text-brand-950">卧底巨星</h1><p className="mt-2 text-sm font-bold text-slate-500">管理多人房间制游戏的启用状态、服务端词组与运行概览。</p></header>
      {message ? <p role="status" className="bg-emerald-50 p-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}
      <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-brand-950">基础设置</h2><p className="mt-1 text-sm font-bold text-slate-500">停用只阻止新房间，已经开始的对局仍可正常完成。</p></div><button type="button" onClick={() => void toggleEnabled()} className={`px-4 py-3 text-sm font-black text-white ${config?.enabled ? 'bg-emerald-700' : 'bg-slate-600'}`}>{config?.enabled ? '已启用' : '已停用'}</button></div></section>
      <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-xl font-black text-brand-950">运行概览</h2><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">{[['今日参与人数', overview?.todayParticipants || 0], ['今日完成局数', overview?.todayCompletedGames || 0], ['历史完成局数', overview?.historicalCompletedGames || 0], ['启用词组', overview?.enabledWordPairs || 0], ['词组总数', overview?.totalWordPairs || 0]].map(([label, value]) => <div key={String(label)} className="border border-sky-100 p-4"><span className="text-xs font-bold text-slate-500">{label}</span><strong className="mt-2 block text-2xl font-black text-brand-950">{value}</strong></div>)}</div></section>
      <section className="border border-sky-100 bg-white p-5 shadow-sm sm:p-6"><div><h2 className="text-xl font-black text-brand-950">词组库</h2><p className="mt-1 text-sm font-bold text-slate-500">新词组会检查空值、相同词和重复词组。</p></div><form onSubmit={save} className="mt-4 grid gap-3 md:grid-cols-2" id="undercover-word-pair-form"><input required value={form.civilianWord} onChange={(event) => setForm({ ...form, civilianWord: event.target.value })} className="border border-sky-100 px-3 py-3 text-sm font-bold" placeholder="平民词" /><input required value={form.undercoverWord} onChange={(event) => setForm({ ...form, undercoverWord: event.target.value })} className="border border-sky-100 px-3 py-3 text-sm font-bold" placeholder="卧底词" /><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as Category })} className="border border-sky-100 px-3 py-3 text-sm font-bold">{Object.entries(categoryLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value as Difficulty })} className="border border-sky-100 px-3 py-3 text-sm font-bold">{Object.entries(difficultyLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><div className="flex gap-2 md:col-span-2"><button disabled={busy} className="bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : editingId ? '保存编辑' : '新增词组'}</button>{editingId ? <button type="button" onClick={() => { setEditingId(null); setForm({ civilianWord: '', undercoverWord: '', category: 'GENERAL', difficulty: 'NORMAL', enabled: true }) }} className="bg-sky-50 px-5 py-3 text-sm font-black text-brand-700">取消编辑</button> : null}</div></form><div className="mt-5 flex flex-wrap gap-2"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} className="border border-sky-100 px-3 py-2 text-sm font-bold" placeholder="搜索词语" /><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }} className="border border-sky-100 px-3 py-2 text-sm font-bold"><option value="">全部分类</option>{Object.entries(categoryLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={difficulty} onChange={(event) => { setDifficulty(event.target.value); setPage(1) }} className="border border-sky-100 px-3 py-2 text-sm font-bold"><option value="">全部难度</option>{Object.entries(difficultyLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><span className="self-center text-xs font-bold text-slate-500">共 {total} 组</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-sky-100 text-xs font-black text-slate-500"><tr><th className="p-3">平民词</th><th className="p-3">卧底词</th><th className="p-3">分类</th><th className="p-3">难度</th><th className="p-3">状态</th><th className="p-3">使用次数</th><th className="p-3">操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-sky-50 last:border-0"><td className="break-words p-3 font-black text-brand-950">{row.civilianWord}</td><td className="break-words p-3 font-black text-brand-950">{row.undercoverWord}</td><td className="p-3">{row.categoryLabel}</td><td className="p-3">{row.difficultyLabel || difficultyLabel[row.difficulty]}</td><td className="p-3 text-xs font-black">{row.configuredEnabled ? <span className="text-emerald-700">启用</span> : <span className="text-slate-400">停用</span>}</td><td className="p-3 font-bold text-slate-600">{row.usageCount}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void toggleRow(row)} className="bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">{row.configuredEnabled ? '停用' : '启用'}</button><button type="button" onClick={() => { setEditingId(row.id); setForm({ civilianWord: row.civilianWord, undercoverWord: row.undercoverWord, category: row.category, difficulty: row.difficulty, enabled: row.configuredEnabled }); document.getElementById('undercover-word-pair-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} className="bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">编辑</button><button type="button" onClick={() => void remove(row)} className="bg-red-50 px-3 py-2 text-xs font-black text-red-600">删除</button></div></td></tr>)}</tbody></table>{!rows.length ? <p className="p-6 text-center text-sm font-bold text-slate-500">当前没有词组。</p> : null}</div><Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} ariaLabel="卧底巨星词组分页" /></section>
    </main>
  )
}
