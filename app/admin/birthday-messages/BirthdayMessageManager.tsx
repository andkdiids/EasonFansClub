'use client'

import { useState } from 'react'

export type BirthdayMessage = {
  id: string
  title: string
  content: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function BirthdayMessageManager({ initialMessages }: Readonly<{ initialMessages: BirthdayMessage[] }>) {
  const [messages, setMessages] = useState(initialMessages)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newActive, setNewActive] = useState(true)

  const [editingId, setEditingId] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editActive, setEditActive] = useState(true)

  const activeCount = messages.filter((item) => item.isActive).length

  async function createMessage() {
    if (busyId) return
    setBusyId('create')
    setError('')
    setMessage('')
    if (!newContent.trim()) {
      setError('请填写生日祝福内容')
      setBusyId('')
      return
    }
    try {
      const response = await fetch('/api/admin/birthday-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, content: newContent, isActive: newActive }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '创建失败')
        return
      }
      setMessages((prev) => [data.message, ...prev])
      setMessage('已新增生日祝福文案')
      setNewTitle('')
      setNewContent('')
      setNewActive(true)
    } catch {
      setError('网络错误，请重试')
    } finally {
      setBusyId('')
    }
  }

  async function toggle(item: BirthdayMessage) {
    if (busyId) return
    setBusyId(item.id)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/birthday-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '状态更新失败')
        return
      }
      setMessages((prev) => prev.map((row) => (row.id === item.id ? data.message : row)))
      setMessage(data.message?.title ? `已更新「${data.message.title}」` : '状态已更新')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setBusyId('')
    }
  }

  function startEdit(item: BirthdayMessage) {
    setEditingId(item.id)
    setEditTitle(item.title)
    setEditContent(item.content)
    setEditActive(item.isActive)
    setError('')
    setMessage('')
  }

  function cancelEdit() {
    setEditingId('')
    setEditTitle('')
    setEditContent('')
    setEditActive(true)
  }

  async function saveEdit(item: BirthdayMessage) {
    if (busyId) return
    setBusyId(item.id)
    setError('')
    setMessage('')
    if (!editContent.trim()) {
      setError('生日祝福内容不能为空')
      setBusyId('')
      return
    }
    try {
      const response = await fetch('/api/admin/birthday-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, title: editTitle, content: editContent, isActive: editActive }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '保存失败')
        return
      }
      setMessages((prev) => prev.map((row) => (row.id === item.id ? data.message : row)))
      setMessage('已保存修改')
      cancelEdit()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setBusyId('')
    }
  }

  async function remove(item: BirthdayMessage) {
    if (busyId || !window.confirm('确定删除这条生日祝福文案吗？此操作不可撤销。')) return
    setBusyId(item.id)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/birthday-messages?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '删除失败')
        return
      }
      setMessages((prev) => prev.filter((row) => row.id !== item.id))
      setMessage('已删除该文案')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-5">
      <section className="border border-sky-100 bg-white/90 p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Birthday Messages</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">生日祝福文案</h1>
        <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
          维护生日纪念通知的文案池。用户生日当天系统会从「已启用」的文案中随机选择一条发送；停用或删除的文案不会被选入，文案池为空时会回退到默认祝福。
        </p>
        <div className="mt-5 grid gap-3 border-t border-sky-100 pt-5 sm:grid-cols-2">
          <label className="block text-sm font-bold text-slate-600">
            标题（可选，留空则使用默认「🎂 生日纪念」）
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              maxLength={160}
              placeholder="🎂 生日纪念"
              className="mt-2 w-full border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-brand-950 outline-none focus:border-brand-400"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={newActive} onChange={(event) => setNewActive(event.target.checked)} className="h-4 w-4" />
            创建后启用（参与随机发送）
          </label>
          <label className="block text-sm font-bold text-slate-600 sm:col-span-2">
            祝福内容（必填）
            <textarea
              value={newContent}
              onChange={(event) => setNewContent(event.target.value)}
              rows={3}
              maxLength={10000}
              placeholder="今天是你的生日，E院为你送上一份生日纪念……"
              className="mt-2 w-full resize-y border border-sky-100 bg-white px-3 py-2 text-sm font-bold leading-6 text-brand-950 outline-none focus:border-brand-400"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={createMessage} disabled={Boolean(busyId)} className="min-h-11 bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-50">
            {busyId === 'create' ? '保存中…' : '新增文案'}
          </button>
        </div>
        {message ? <p className="mt-4 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
      </section>

      <section className="border border-sky-100 bg-white/90 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-brand-950">文案池</h2>
          <span className="text-sm font-bold text-slate-500">{activeCount} / {messages.length} 条已启用</span>
        </div>
        {!messages.length ? (
          <p className="mt-5 bg-sky-50 p-5 text-sm font-bold text-slate-500">尚未添加任何生日祝福文案。发送生日通知时会使用默认祝福。</p>
        ) : (
          <div className="mt-5 space-y-4">
            {messages.map((item) => (
              <article key={item.id} className="border border-sky-100 bg-sky-50/60 p-4">
                {editingId === item.id ? (
                  <div className="space-y-3">
                    <input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={160}
                      placeholder="🎂 生日纪念"
                      className="w-full border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-brand-950 outline-none focus:border-brand-400"
                    />
                    <textarea
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      rows={3}
                      maxLength={10000}
                      className="w-full resize-y border border-sky-100 bg-white px-3 py-2 text-sm font-bold leading-6 text-brand-950 outline-none focus:border-brand-400"
                    />
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
                      <input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} className="h-4 w-4" />
                      启用
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => saveEdit(item)} disabled={Boolean(busyId)} className="min-h-11 bg-brand-950 text-sm font-black text-white disabled:opacity-50">保存</button>
                      <button type="button" onClick={cancelEdit} disabled={Boolean(busyId)} className="min-h-11 border border-sky-100 bg-white text-sm font-black text-brand-700 disabled:opacity-50">取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-black text-brand-950">{item.title || '🎂 生日纪念'}</h3>
                      <span className={`shrink-0 px-2 py-1 text-xs font-black ${item.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{item.isActive ? '已启用' : '已停用'}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-600">{item.content}</p>
                    <p className="mt-2 text-xs font-bold text-slate-400">创建于 {new Date(item.createdAt).toLocaleDateString('zh-CN')}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button type="button" onClick={() => startEdit(item)} disabled={Boolean(busyId)} className="min-h-11 border border-sky-100 bg-white text-sm font-black text-brand-700 disabled:opacity-50">编辑</button>
                      <button type="button" onClick={() => toggle(item)} disabled={Boolean(busyId)} className="min-h-11 border border-sky-100 bg-white text-sm font-black text-brand-700 disabled:opacity-50">{item.isActive ? '停用' : '启用'}</button>
                      <button type="button" onClick={() => remove(item)} disabled={Boolean(busyId)} className="min-h-11 border border-red-100 bg-white text-sm font-black text-red-600 disabled:opacity-50">删除</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
