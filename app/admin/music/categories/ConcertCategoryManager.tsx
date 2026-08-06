'use client'

import { useState, type FormEvent } from 'react'
import type { ConcertCategoryConfig } from '@/lib/music-concert-category'

type Row = ConcertCategoryConfig & { reserved?: boolean }

const RESERVED_SLUGS = ['main', 'small', 'guest']

export function ConcertCategoryManager({ initialCategories }: { initialCategories: ConcertCategoryConfig[] }) {
  const [rows, setRows] = useState<Row[]>(initialCategories.map((category) => ({ ...category, reserved: RESERVED_SLUGS.includes(category.slug) })))
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const response = await fetch('/api/admin/music/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug: slug || undefined, sortOrder, enabled }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '创建失败')
        return
      }
      const created = data.category as ConcertCategoryConfig
      setRows((prev) => [...prev, { ...created, reserved: false }].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
      setMessage('分类已创建')
      setName('')
      setSlug('')
      setSortOrder(0)
      setEnabled(true)
    } finally {
      setBusy(false)
    }
  }

  async function update(row: Row, patch: Partial<ConcertCategoryConfig>) {
    setError('')
    setMessage('')
    const response = await fetch(`/api/admin/music/categories/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || '更新失败')
      return
    }
    const updated = data.category as ConcertCategoryConfig
    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, ...updated } : item)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
    setMessage('已保存')
  }

  async function remove(row: Row) {
    if (row.reserved) return
    if (!confirm(`确定删除分类「${row.name}」？该操作不可恢复。`)) return
    setError('')
    setMessage('')
    const response = await fetch(`/api/admin/music/categories/${row.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || '删除失败')
      return
    }
    setRows((prev) => prev.filter((item) => item.id !== row.id))
    setMessage('已删除')
  }

  return (
    <section className="space-y-6">
      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}

      <form onSubmit={create} className="rounded-[26px] border border-sky-100 bg-white/90 p-6 shadow-sm">
        <h2 className="text-2xl font-black text-brand-950">新增分类</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-black text-slate-600">名称<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" placeholder="例如：线上演唱会" /></label>
          <label className="text-sm font-black text-slate-600">标识 slug<input value={slug} onChange={(event) => setSlug(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" placeholder="留空自动生成（核心项不可改）" /></label>
          <label className="text-sm font-black text-slate-600">排序<input type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label>
          <label className="flex items-center gap-2 text-sm font-black text-slate-600">启用<input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-2 h-5 w-5" /></label>
        </div>
        <button type="submit" disabled={busy} className="mt-5 rounded-full bg-brand-950 px-6 py-3 text-sm font-black text-white disabled:opacity-60">创建分类</button>
      </form>

      <div className="overflow-hidden rounded-[26px] border border-sky-100 bg-white/90 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-sky-50/70 text-xs font-black uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">名称</th>
              <th className="px-4 py-3">slug</th>
              <th className="px-4 py-3">排序</th>
              <th className="px-4 py-3">启用</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-sky-100">
                <td className="px-4 py-3"><input value={row.name} onChange={(event) => setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))} onBlur={() => update(row, { name: row.name })} className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-black text-brand-950 hover:border-sky-100 focus:border-sky-300" /></td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.slug}{row.reserved ? ' · 核心' : ''}</td>
                <td className="px-4 py-3"><input type="number" value={row.sortOrder} onChange={(event) => setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, sortOrder: Number(event.target.value) } : item))} onBlur={() => update(row, { sortOrder: row.sortOrder })} className="w-20 rounded-lg border border-sky-100 px-2 py-1" /></td>
                <td className="px-4 py-3"><input type="checkbox" checked={row.enabled} onChange={(event) => { const next = event.target.checked; setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, enabled: next } : item)); update(row, { enabled: next }) }} className="h-5 w-5" /></td>
                <td className="px-4 py-3 text-right">
                  {row.reserved ? <span className="text-xs font-bold text-slate-400">核心分类</span> : <button type="button" onClick={() => remove(row)} className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-600">删除</button>}
                </td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={5} className="px-4 py-8 text-center text-sm font-bold text-slate-400">暂无分类</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
