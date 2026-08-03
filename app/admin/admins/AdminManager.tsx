'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { adminPermissionGroups } from '@/lib/admin-permission-config'

type AdminUser = {
  id: string
  uid: number
  nickname: string
  email: string | null
  phone: string | null
  role: string
  createdAt: string | Date
  permissions: string[]
  canPlayFullMusic: boolean
}

type SearchUser = {
  id: string
  uid: number
  nickname: string
  email: string | null
  phone: string | null
  role: string
  status: string
  profile: { displayName: string; avatarUrl: string | null } | null
}

type AdminLog = {
  id: string
  action: string
  reason: string | null
  createdAt: string | Date
  adminName: string
  targetName: string | null
}

export function AdminManager({
  admins,
  searchUsers,
  query,
  logs,
}: Readonly<{ admins: AdminUser[]; searchUsers: SearchUser[]; query: string; logs: AdminLog[] }>) {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submittingId, setSubmittingId] = useState('')

  async function saveAdmin(userId: string, permissions: string[], canPlayFullMusic: boolean) {
    setSubmittingId(userId)
    setMessage('')
    setError('')
    const response = await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, permissions, canPlayFullMusic }),
    })
    const data = await response.json().catch(() => ({}))
    setSubmittingId('')
    if (!response.ok) {
      setError(data.message || '操作失败')
      return
    }
    setMessage('管理员权限已保存')
    router.refresh()
  }

  async function removeAdmin(userId: string) {
    if (!confirm('确认取消该用户的管理员身份吗？')) return
    setSubmittingId(userId)
    setMessage('')
    setError('')
    const response = await fetch(`/api/admin/admins/${userId}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    setSubmittingId('')
    if (!response.ok) {
      setError(data.message || '操作失败')
      return
    }
    setMessage('管理员身份已取消')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Admin Manage</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">管理员管理</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
          搜索用户，设置管理员身份，并为普通管理员分配可访问的后台模块。
        </p>
        {message ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-700">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm sm:p-6">
        <h2 className="text-2xl font-black text-brand-950">添加管理员</h2>
        <form action="/admin/admins" className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            name="q"
            defaultValue={query}
            placeholder="输入 UID / 昵称 / 手机号 / 邮箱搜索"
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-4 font-bold outline-none"
          />
          <button className="min-h-12 rounded-xl bg-brand-700 px-5 font-black text-white">搜索用户</button>
        </form>

        {query ? (
          <div className="mt-5 grid gap-3">
            {searchUsers.length ? searchUsers.map((user) => (
              <PermissionCard
                key={user.id}
                user={{
                  id: user.id,
                  uid: user.uid,
                  nickname: user.profile?.displayName || user.nickname,
                  email: user.email,
                  phone: user.phone,
                  role: user.role,
                  createdAt: new Date(),
                  permissions: [],
                  canPlayFullMusic: false,
                }}
                onSave={saveAdmin}
                isSubmitting={submittingId === user.id}
                actionLabel={user.role === 'ADMIN' ? '更新权限' : '设置为管理员'}
              />
            )) : <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">没有找到可设置的 active 用户。</p>}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm sm:p-6">
        <h2 className="text-2xl font-black text-brand-950">管理员列表</h2>
        <div className="mt-5 grid gap-4">
          {admins.map((admin) => (
            <PermissionCard
              key={admin.id}
              user={admin}
              onSave={saveAdmin}
              onRemove={admin.role === 'SUPER_ADMIN' ? undefined : removeAdmin}
              isSubmitting={submittingId === admin.id}
              actionLabel="保存权限"
            />
          ))}
          {!admins.length ? <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">暂无管理员。</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm sm:p-6">
        <h2 className="text-2xl font-black text-brand-950">管理员操作记录</h2>
        <div className="mt-5 space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl bg-sky-50/80 p-4 text-sm font-bold text-slate-600">
              <p className="text-brand-950">{log.adminName} · {log.action}</p>
              <p className="mt-1">目标：{log.targetName || '无'} · {new Date(log.createdAt).toLocaleString('zh-CN', { hour12: false })}</p>
              {log.reason ? <p className="mt-1 text-slate-500">{log.reason}</p> : null}
            </div>
          ))}
          {!logs.length ? <p className="rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">暂无操作记录。</p> : null}
        </div>
      </section>
    </div>
  )
}

function PermissionCard({
  user,
  onSave,
  onRemove,
  isSubmitting,
  actionLabel,
}: Readonly<{
  user: AdminUser
  onSave: (userId: string, permissions: string[], canPlayFullMusic: boolean) => void
  onRemove?: (userId: string) => void
  isSubmitting: boolean
  actionLabel: string
}>) {
  const [selected, setSelected] = useState(() => new Set(user.permissions))
  const isSuperAdmin = user.role === 'SUPER_ADMIN'
  const [fullMusicEnabled, setFullMusicEnabled] = useState(user.canPlayFullMusic)

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <article className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-brand-950">{user.nickname}</h3>
          <p className="mt-1 text-xs font-bold text-slate-500">
            UID {String(user.uid).padStart(5, '0')} · {user.role} · {user.email || '未绑定邮箱'} · {user.phone || '未绑定手机号'}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-500">
            创建时间：{new Date(user.createdAt).toLocaleString('zh-CN', { hour12: false })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onSave(user.id, Array.from(selected), fullMusicEnabled)}
            disabled={isSubmitting || isSuperAdmin}
            className="min-h-11 rounded-full bg-brand-950 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSuperAdmin ? '超级管理员' : isSubmitting ? '保存中...' : actionLabel}
          </button>
          {onRemove ? (
            <button
              onClick={() => onRemove(user.id)}
              disabled={isSubmitting}
              className="min-h-11 rounded-full bg-white px-4 text-sm font-black text-red-600 disabled:opacity-50"
            >
              取消管理员
            </button>
          ) : null}
        </div>
      </div>

      <label className={`mt-4 block rounded-xl border p-3 ${isSuperAdmin ? 'border-sky-100 bg-white/70 opacity-75' : 'border-white bg-white/80'}`}>
        <span className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={isSuperAdmin || fullMusicEnabled}
            disabled={isSuperAdmin}
            onChange={() => setFullMusicEnabled((current) => !current)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-black text-brand-950">允许完整播放音乐</span>
            <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">
              {isSuperAdmin ? '超级管理员默认拥有完整音频播放权限。' : '开启后，该管理员可播放 EasMusic 完整音频。'}
            </span>
          </span>
        </span>
      </label>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {adminPermissionGroups.map((permission) => (
          <label key={permission.key} className={`rounded-xl border p-3 ${isSuperAdmin ? 'border-sky-100 bg-white/70 opacity-75' : 'border-white bg-white/80'}`}>
            <span className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={isSuperAdmin || selected.has(permission.key)}
                disabled={isSuperAdmin}
                onChange={() => toggle(permission.key)}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-black text-brand-950">{permission.label}</span>
                <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">{permission.description}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
    </article>
  )
}
