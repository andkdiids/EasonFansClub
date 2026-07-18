'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type AdminUser = {
  id: string
  uid: number
  username: string
  nickname: string
  email: string | null
  phone: string | null
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  avatarUrl: string | null
  role: string
  status: string
  level: number
  exp: number
  points: number
  isDeleted: boolean
  createdAt: string
  securityQuestionsSet: boolean
  securityQuestionRecoveryEnabled: boolean
  lastPasswordResetAt: string | null
  securityQuestionFailureCount: number
  securityQuestionLastFailedAt: string | null
  securityQuestionLockedUntil: string | null
}

type DeletePreview = {
  user: {
    id: string
    uid: number
    nickname: string
    avatarUrl: string | null
    phone: string | null
    email: string | null
    createdAt: string
    role: string
  }
  counts: {
    posts: number
    replies: number
    friends: number
    checkIns: number
    achievements: number
    dailyMessages: number
    publicDailyReplies: number
    privateMessages: number
    notifications: number
    favorites: number
    likes: number
  }
  hasPublicContent: boolean
}

function formatUid(uid: number) {
  return String(uid).padStart(5, '0')
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function AdminUsersManager({ canManageAccountSecurity }: { canManageAccountSecurity: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState<AdminUser | null>(null)
  const [preview, setPreview] = useState<DeletePreview | null>(null)
  const [confirmUid, setConfirmUid] = useState('')
  const [deletePublicContent, setDeletePublicContent] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [securityBusyUserId, setSecurityBusyUserId] = useState<string | null>(null)

  async function loadUsers(search = query) {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '用户列表加载失败')
      setUsers(data.users || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function openDeleteModal(user: AdminUser) {
    setTarget(user)
    setPreview(null)
    setConfirmUid('')
    setDeletePublicContent(false)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '删除预览加载失败')
      setPreview(data.preview)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除预览加载失败')
    }
  }

  async function deleteUser() {
    if (!target || !preview || confirmUid !== formatUid(preview.user.uid) || isDeleting) return

    setIsDeleting(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/users/${target.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmUid,
          deletePublicContent,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '删除失败')
      setUsers((items) => items.filter((item) => item.id !== target.id))
      setTarget(null)
      setPreview(null)
      setMessage(data?.message || '删除成功')
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setIsDeleting(false)
    }
  }

  async function updateSecurityRecovery(user: AdminUser) {
    if (!canManageAccountSecurity || securityBusyUserId) return
    const nextEnabled = !user.securityQuestionRecoveryEnabled
    const confirmed = window.confirm(nextEnabled
      ? '确认重新启用该用户的密保问题找回吗？'
      : '确认停用该用户的密保问题找回吗？\n停用后，该用户将无法通过密保问题重置密码。')
    if (!confirmed) return

    setSecurityBusyUserId(user.id)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/admin/users/${user.id}/security-recovery`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ securityQuestionRecoveryEnabled: nextEnabled }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '密保找回状态更新失败')
      setUsers((current) => current.map((item) => item.id === user.id
        ? { ...item, securityQuestionRecoveryEnabled: nextEnabled }
        : item))
      setMessage(data?.message || '密保找回状态已更新')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '密保找回状态更新失败')
    } finally {
      setSecurityBusyUserId(null)
    }
  }

  useEffect(() => {
    loadUsers('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canConfirmDelete = useMemo(() => {
    return Boolean(preview && confirmUid === formatUid(preview.user.uid) && !isDeleting)
  }, [confirmUid, isDeleting, preview])

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/85 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Users</p>
          <h2 className="mt-2 text-2xl font-black text-brand-950">用户列表</h2>
          <p className="mt-2 text-sm font-bold leading-7 text-slate-500">永久删除前会展示影响范围，并要求输入 UID 二次确认。</p>
        </div>
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault()
            loadUsers(query)
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="UID / 昵称 / 手机 / 邮箱"
            className="min-h-11 min-w-0 flex-1 rounded-full border border-sky-100 bg-white px-4 text-sm font-bold outline-none focus:border-brand-400 sm:w-72"
          />
          <button className="min-h-11 rounded-full bg-brand-700 px-5 text-sm font-black text-white" disabled={loading}>
            搜索
          </button>
        </form>
      </div>

      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-[1240px] w-full border-separate border-spacing-y-2 text-left text-sm">
          <thead className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            <tr>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">联系方式</th>
              <th className="px-3 py-2">角色</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">密保</th>
              <th className="px-3 py-2">积分</th>
              <th className="px-3 py-2">注册时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="rounded-2xl bg-sky-50 px-4 py-8 text-center font-black text-slate-500">
                  加载中...
                </td>
              </tr>
            ) : users.length ? (
              users.map((user) => (
                <tr key={user.id} className="rounded-2xl bg-white shadow-sm">
                  <td className="rounded-l-2xl px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid size-11 place-items-center overflow-hidden rounded-full bg-brand-950 text-sm font-black text-white">
                        {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-full object-cover" /> : user.nickname.slice(0, 1)}
                      </div>
                      <div>
                        <p className="font-black text-brand-950">{user.nickname}</p>
                        <p className="text-xs font-bold text-slate-500">UID {formatUid(user.uid)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-600">
                    <p>{user.phone || '未绑定手机'}</p>
                    {user.phone ? <p className="text-xs text-amber-600">{user.phoneVerifiedAt ? '手机号已验证' : '手机号未验证'}</p> : null}
                    <p className="mt-1 text-xs text-slate-400">{user.email || '未绑定邮箱'}</p>
                    {user.email ? <p className="text-xs text-slate-400">{user.emailVerifiedAt ? '邮箱已验证' : '邮箱未验证'}</p> : null}
                  </td>
                  <td className="px-3 py-3 font-black text-brand-700">{user.role}</td>
                  <td className="px-3 py-3 font-black text-slate-600">{user.status}</td>
                  <td className="px-3 py-3 text-slate-600">
                    <p className={`font-black ${user.securityQuestionsSet ? 'text-emerald-700' : 'text-slate-500'}`}>密保问题：{user.securityQuestionsSet ? '已设置' : '未设置'}</p>
                    <p className={`mt-1 text-xs font-black ${user.securityQuestionRecoveryEnabled ? 'text-emerald-700' : 'text-amber-700'}`}>密保找回：{user.securityQuestionRecoveryEnabled ? '已启用' : '已停用'}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400">邮箱：{user.email ? '已绑定' : '未绑定'} / {user.emailVerifiedAt ? '已验证' : '未验证'}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400">最近重置：{user.lastPasswordResetAt ? formatDate(user.lastPasswordResetAt) : '暂无'}</p>
                    {user.securityQuestionFailureCount > 0 ? <p className="mt-1 text-xs font-bold text-amber-700">近期失败 {user.securityQuestionFailureCount} 次{user.securityQuestionLockedUntil ? `，锁定至 ${formatDate(user.securityQuestionLockedUntil)}` : ''}</p> : null}
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-600">
                    Lv.{user.level} / {user.points} 分
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-500">{formatDate(user.createdAt)}</td>
                  <td className="rounded-r-2xl px-3 py-3 text-right">
                    <Link href={`/admin/users/${user.id}`} className="mb-2 ml-2 inline-flex min-h-10 items-center rounded-full border border-sky-200 bg-sky-50 px-4 text-sm font-black text-brand-700">查看详情</Link>
                    {canManageAccountSecurity && user.role !== 'SUPER_ADMIN' ? (
                      <button
                        type="button"
                        onClick={() => updateSecurityRecovery(user)}
                        disabled={securityBusyUserId === user.id || (!user.securityQuestionRecoveryEnabled && !user.securityQuestionsSet)}
                        className={`mb-2 min-h-10 rounded-full px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${user.securityQuestionRecoveryEnabled ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'bg-emerald-600 text-white'}`}
                      >
                        {securityBusyUserId === user.id ? '处理中...' : user.securityQuestionRecoveryEnabled ? '停用密保找回' : '启用密保找回'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openDeleteModal(user)}
                      className="min-h-10 rounded-full border border-red-200 bg-red-50 px-4 text-sm font-black text-red-600"
                    >
                      永久删除
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="rounded-2xl bg-sky-50 px-4 py-8 text-center font-black text-slate-500">
                  暂无用户。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {target ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-sky-100 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-red-500">Danger Zone</p>
                <h3 className="mt-2 text-2xl font-black text-brand-950">确认永久删除</h3>
                <p className="mt-2 text-sm font-bold leading-7 text-slate-500">删除后无法恢复。请核对用户信息，并输入 UID 才能继续。</p>
              </div>
              <button
                type="button"
                onClick={() => setTarget(null)}
                disabled={isDeleting}
                className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700"
              >
                取消
              </button>
            </div>

            {preview ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-4 rounded-2xl bg-sky-50 p-4">
                  <div className="grid size-16 place-items-center overflow-hidden rounded-full bg-brand-950 text-xl font-black text-white">
                    {preview.user.avatarUrl ? <img src={preview.user.avatarUrl} alt="" className="size-full object-cover" /> : preview.user.nickname.slice(0, 1)}
                  </div>
                  <div>
                    <p className="text-xl font-black text-brand-950">{preview.user.nickname}</p>
                    <p className="text-sm font-bold text-slate-500">UID {formatUid(preview.user.uid)} / {preview.user.role}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400">{preview.user.phone || '未绑定手机'} / {preview.user.email || '未绑定邮箱'}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400">注册于 {formatDate(preview.user.createdAt)}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  {Object.entries(preview.counts).map(([key, value]) => (
                    <div key={key} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100">
                      <p className="text-xs font-black uppercase text-slate-400">{key}</p>
                      <p className="mt-2 text-2xl font-black text-brand-950">{value}</p>
                    </div>
                  ))}
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-sky-100 bg-white p-4 text-sm font-bold text-slate-600">
                  <input
                    type="checkbox"
                    checked={deletePublicContent}
                    onChange={(event) => setDeletePublicContent(event.target.checked)}
                    className="mt-1 size-4"
                  />
                  <span>
                    同时删除这个用户的公开帖子、回复和 E友留言。默认不勾选时，公开内容会保留并显示为“已注销用户”。
                  </span>
                </label>

                <div>
                  <label className="text-sm font-black text-brand-950">请输入 UID {formatUid(preview.user.uid)} 确认删除</label>
                  <input
                    value={confirmUid}
                    onChange={(event) => setConfirmUid(event.target.value.trim())}
                    placeholder={formatUid(preview.user.uid)}
                    className="mt-2 min-h-12 w-full rounded-2xl border border-sky-100 px-4 font-black outline-none focus:border-red-300"
                  />
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setTarget(null)}
                    disabled={isDeleting}
                    className="min-h-11 rounded-full bg-sky-50 px-5 text-sm font-black text-brand-700"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={deleteUser}
                    disabled={!canConfirmDelete}
                    className="min-h-11 rounded-full bg-red-600 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isDeleting ? '删除中...' : '确认永久删除'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl bg-sky-50 px-4 py-8 text-center font-black text-slate-500">正在加载删除预览...</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
