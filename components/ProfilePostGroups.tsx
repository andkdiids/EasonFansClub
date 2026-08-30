'use client'

import { useState } from 'react'
import { PROFILE_POST_GROUP_UNGROUPED, type ProfilePostGroupView } from '@/lib/profile-post-groups'

type GroupBarProps = {
  groups: ProfilePostGroupView[]
  activeGroupId: string
  isSelf: boolean
  onSelect: (groupId: string) => void
  onChanged: () => void
}

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({})) as { message?: unknown }
  return typeof data.message === 'string' ? data.message : fallback
}

export function ProfilePostGroupBar({ groups, activeGroupId, isSelf, onSelect, onChanged }: Readonly<GroupBarProps>) {
  const [manageOpen, setManageOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function createGroup() {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/profile/post-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!response.ok) throw new Error(await readError(response, '分组创建失败'))
      setNewName('')
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分组创建失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function renameGroup(groupId: string) {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/profile/post-groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName }),
      })
      if (!response.ok) throw new Error(await readError(response, '分组重命名失败'))
      setEditingId(null)
      setEditingName('')
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分组重命名失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function moveGroup(groupId: string, direction: 'up' | 'down') {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/profile/post-groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      if (!response.ok) throw new Error(await readError(response, '分组排序失败'))
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分组排序失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function deleteGroup(group: ProfilePostGroupView) {
    if (isSubmitting || !window.confirm(`删除“${group.name}”？帖子不会被删除，并会变为未分组。`)) return
    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/profile/post-groups/${encodeURIComponent(group.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response, '分组删除失败'))
      if (activeGroupId === group.id) onSelect('')
      else onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分组删除失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="mb-4 min-w-0 border-b border-[var(--border)] pb-3" aria-label="个人帖子分组">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" aria-pressed={activeGroupId === ''} onClick={() => onSelect('')} className={`rounded-lg px-3 py-1.5 text-xs font-black ${activeGroupId === '' ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>全部</button>
        <button type="button" aria-pressed={activeGroupId === PROFILE_POST_GROUP_UNGROUPED} onClick={() => onSelect(PROFILE_POST_GROUP_UNGROUPED)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${activeGroupId === PROFILE_POST_GROUP_UNGROUPED ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>未分组</button>
        {groups.map((group) => (
          <button key={group.id} type="button" aria-pressed={activeGroupId === group.id} onClick={() => onSelect(group.id)} className={`max-w-full truncate rounded-lg px-3 py-1.5 text-xs font-black ${activeGroupId === group.id ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{group.name}</button>
        ))}
        {isSelf ? <button type="button" onClick={() => { setManageOpen((value) => !value); setError('') }} className="ml-auto rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-black text-brand-700">{manageOpen ? '收起管理' : '管理分组'}</button> : null}
      </div>

      {isSelf && manageOpen ? (
        <div className="mt-3 border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          <form className="flex min-w-0 flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void createGroup() }}>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={20} placeholder="新分组名称" aria-label="新分组名称" className="min-h-9 min-w-0 flex-1 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm font-bold text-brand-950 outline-none focus:border-brand-500" />
            <button type="submit" disabled={isSubmitting || !newName.trim()} className="min-h-9 bg-brand-950 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">新建</button>
          </form>
          {groups.length ? (
            <ul className="mt-3 space-y-2">
              {groups.map((group, index) => (
                <li key={group.id} className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold text-brand-950">
                  {editingId === group.id ? (
                    <>
                      <input value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={20} aria-label={`重命名${group.name}`} className="min-h-8 min-w-0 flex-1 border border-[var(--border)] bg-[var(--surface)] px-2 text-sm font-bold outline-none focus:border-brand-500" />
                      <button type="button" disabled={isSubmitting} onClick={() => void renameGroup(group.id)} className="text-xs text-brand-700">保存</button>
                      <button type="button" disabled={isSubmitting} onClick={() => setEditingId(null)} className="text-xs text-slate-500">取消</button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{group.name}</span>
                      <button type="button" disabled={isSubmitting} onClick={() => { setEditingId(group.id); setEditingName(group.name) }} className="text-xs text-brand-700">重命名</button>
                      <button type="button" disabled={isSubmitting || index === 0} onClick={() => void moveGroup(group.id, 'up')} className="text-xs text-slate-500 disabled:opacity-40">上移</button>
                      <button type="button" disabled={isSubmitting || index === groups.length - 1} onClick={() => void moveGroup(group.id, 'down')} className="text-xs text-slate-500 disabled:opacity-40">下移</button>
                      <button type="button" disabled={isSubmitting} onClick={() => void deleteGroup(group)} className="text-xs text-red-600">删除</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-xs font-bold text-slate-500">还没有自定义分组。</p>}
          {error ? <p className="mt-3 text-xs font-bold text-red-600" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

export function PersonalPostGroupMenu({
  postId,
  currentGroupId,
  groups,
  onChanged,
}: Readonly<{
  postId: string
  currentGroupId: string | null
  groups: ProfilePostGroupView[]
  onChanged: () => void
}>) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function assignGroup(groupId: string) {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/profile-group`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: groupId === PROFILE_POST_GROUP_UNGROUPED ? null : groupId }),
      })
      if (!response.ok) throw new Error(await readError(response, '帖子分组保存失败'))
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '帖子分组保存失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <label className="inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] font-black text-slate-500" title={error || '设置个人分组'}>
      <span className="sr-only">设置个人分组</span>
      <select aria-label="设置个人分组" value={currentGroupId || PROFILE_POST_GROUP_UNGROUPED} disabled={isSubmitting} onChange={(event) => void assignGroup(event.target.value)} className="max-w-[140px] min-h-8 border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[11px] font-black text-brand-700 outline-none">
        <option value={PROFILE_POST_GROUP_UNGROUPED}>未分组</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
      {error ? <span className="sr-only">{error}</span> : null}
    </label>
  )
}
