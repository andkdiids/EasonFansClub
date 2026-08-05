'use client'

import { useMemo, useState } from 'react'
import type { RegistrationMessageRow } from './page'

const STATUS_LABEL: Record<RegistrationMessageRow['status'], string> = {
  PENDING: '待审核',
  APPROVED: '已发布',
  REJECTED: '已隐藏',
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function RegistrationMessageManager({ initialMessages }: { initialMessages: RegistrationMessageRow[] }) {
  const [messages, setMessages] = useState<RegistrationMessageRow[]>(initialMessages)
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // 新增表单
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<'APPROVED' | 'REJECTED'>('APPROVED')
  const [sort, setSort] = useState(0)
  const [adding, setAdding] = useState(false)

  function applyUpdate(updated: RegistrationMessageRow) {
    setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)))
  }
  function applyDelete(id: string) {
    setMessages((current) => current.filter((item) => item.id !== id))
  }

  async function remove(id: string) {
    setBusyId(id)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/registration-messages/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage(data?.message || '删除失败')
        return
      }
      applyDelete(id)
      setMessage('已删除该留言')
    } catch {
      setMessage('网络错误，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  async function patch(id: string, patchData: Partial<Pick<RegistrationMessageRow, 'status' | 'sort'>>) {
    setBusyId(id)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/registration-messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchData),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.messageRow) {
        setMessage(data?.message || '操作失败')
        return
      }
      applyUpdate(data.messageRow)
    } catch {
      setMessage('网络错误，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  async function add() {
    setAdding(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/registration-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, moderationStatus: status, sort: Number(sort) || 0 }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.messageRow) {
        setMessage(data?.message || '发布失败')
        return
      }
      setMessages((current) => [data.messageRow, ...current])
      setContent('')
      setSort(0)
      setStatus('APPROVED')
      setMessage('已发布管理员留言')
    } catch {
      setMessage('网络错误，请稍后重试')
    } finally {
      setAdding(false)
    }
  }

  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          Number(b.isAdminMessage) - Number(a.isAdminMessage) ||
          a.sort - b.sort ||
          (a.createdAt < b.createdAt ? 1 : -1),
      ),
    [messages],
  )

  return (
    <section className="space-y-6">
      {/* 新增管理员留言 */}
      <div className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm">
        <h2 className="text-xl font-black text-brand-950">发布管理员留言</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">管理员留言会在挂号页优先展示（系统公告 / 活动提醒 / 精选留言）。</p>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          placeholder="输入留言内容"
          className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-sm font-black text-slate-600">
            发布状态
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as 'APPROVED' | 'REJECTED')}
              className="ml-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            >
              <option value="APPROVED">已发布</option>
              <option value="REJECTED">隐藏</option>
            </select>
          </label>
          <label className="text-sm font-black text-slate-600">
            排序
            <input
              type="number"
              value={sort}
              onChange={(event) => setSort(Number(event.target.value))}
              className="ml-2 w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={adding || !content.trim()}
            onClick={() => void add()}
            className="rounded-full bg-brand-700 px-5 py-2 text-sm font-black text-white disabled:opacity-50"
          >
            {adding ? '发布中…' : '发布留言'}
          </button>
        </div>
      </div>

      {message ? (
        <p className="rounded-2xl bg-sky-50 px-4 py-2 text-sm font-bold text-brand-700 ring-1 ring-sky-100">{message}</p>
      ) : null}

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-10 text-center text-sm font-bold text-slate-400">
          还没有挂号页留言
        </p>
      ) : (
        <div className="grid gap-4">
          {sorted.map((item) => (
            <article
              key={item.id}
              className={`rounded-[24px] border p-5 shadow-sm ${
                item.isDeleted ? 'border-red-100 bg-red-50/40' : 'border-sky-100 bg-white/90'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-black ${
                        item.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : item.status === 'REJECTED'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                    {item.isAdminMessage ? (
                      <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-black text-brand-700">管理员</span>
                    ) : null}
                    {item.isDeleted ? (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-black text-red-700">已删除</span>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">{item.content}</p>
                  <p className="mt-2 text-xs font-bold text-slate-400">
                    {item.user.nickname}（UID {item.user.uid}） · {formatDate(item.createdAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-black text-slate-500">
                      状态
                      <select
                        value={item.status}
                        disabled={busyId === item.id}
                        onChange={(event) => void patch(item.id, { status: event.target.value as RegistrationMessageRow['status'] })}
                        className="ml-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="APPROVED">已发布</option>
                        <option value="REJECTED">隐藏</option>
                      </select>
                    </label>
                    <label className="text-xs font-black text-slate-500">
                      排序
                      <input
                        type="number"
                        value={item.sort}
                        disabled={busyId === item.id}
                        onChange={(event) => void patch(item.id, { sort: Number(event.target.value) || 0 })}
                        className="ml-1 w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === item.id || item.isDeleted}
                    onClick={() => void remove(item.id)}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-black text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    {item.isDeleted ? '已删除' : '删除'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
