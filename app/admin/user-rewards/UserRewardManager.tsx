'use client'

import { useState, type FormEvent } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Pagination } from '@/components/ui/Pagination'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { profileImageUrl } from '@/lib/images'
import { USER_REWARD_MAX_AMOUNT, USER_REWARD_PAGE_SIZE } from '@/lib/user-reward-constants'

type RewardUser = {
  id: string
  uid: number
  username: string
  nickname: string
  displayName: string
  email: string | null
  phone: string | null
  avatarUrl: string | null
  experience: number
  points: number
}

type RewardHistoryItem = {
  rewardId: string
  transactionId: string
  userId: string
  userUid: number
  username: string
  experienceAmount: number
  registrationFeeAmount: number
  reason: string
  operatorId: string
  operatorName: string
  createdAt: string
}

type Operator = { id: string; uid: number; name: string }

type HistoryPayload = {
  items: RewardHistoryItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type RewardDraft = {
  user: RewardUser
  experienceAmount: number
  registrationFeeAmount: number
  reason: string
}

function formatUid(uid: number) {
  return String(uid).padStart(5, '0')
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
}

function createTransactionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `user-reward-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readAmount(value: string, label: string) {
  if (!value.trim()) return 0
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > USER_REWARD_MAX_AMOUNT) {
    throw new Error(`${label}必须是 0 到 ${USER_REWARD_MAX_AMOUNT} 之间的整数`)
  }
  return amount
}

function rewardLines(draft: Pick<RewardDraft, 'experienceAmount' | 'registrationFeeAmount'>) {
  return [
    draft.experienceAmount > 0 ? `经验值 +${draft.experienceAmount}` : '',
    draft.registrationFeeAmount > 0 ? `挂号费 +${draft.registrationFeeAmount}` : '',
  ].filter(Boolean)
}

function Avatar({ user, size = 'size-12' }: { user: Pick<RewardUser, 'avatarUrl' | 'uid' | 'displayName'>; size?: string }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-sm font-black text-white`}>
      {profileImageUrl(user.avatarUrl) ? (
        <img src={publicImageVariantUrl(user.avatarUrl, 'avatar-md') || profileImageUrl(user.avatarUrl)!} alt="" className="size-full object-cover" loading="lazy" />
      ) : formatUid(user.uid).slice(0, 1)}
    </span>
  )
}

export function UserRewardManager({ initialHistory, operators }: { initialHistory: HistoryPayload; operators: Operator[] }) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<RewardUser[]>([])
  const [selectedUser, setSelectedUser] = useState<RewardUser | null>(null)
  const [searching, setSearching] = useState(false)
  const [experienceAmount, setExperienceAmount] = useState('0')
  const [registrationFeeAmount, setRegistrationFeeAmount] = useState('0')
  const [reason, setReason] = useState('')
  const [confirmDraft, setConfirmDraft] = useState<RewardDraft | null>(null)
  const [transactionId, setTransactionId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState(initialHistory.items)
  const [historyPage, setHistoryPage] = useState(initialHistory.page)
  const [historyTotal, setHistoryTotal] = useState(initialHistory.total)
  const [historyTotalPages, setHistoryTotalPages] = useState(initialHistory.totalPages)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyUserQuery, setHistoryUserQuery] = useState('')
  const [historyOperatorId, setHistoryOperatorId] = useState('')
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')

  async function searchUsers(event: FormEvent) {
    event.preventDefault()
    const keyword = query.trim()
    if (!keyword || searching) return
    setSearching(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/user-rewards/users?q=${encodeURIComponent(keyword)}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { users?: RewardUser[]; message?: string } | null
      if (!response.ok) throw new Error(data?.message || '用户搜索失败')
      setSearchResults(Array.isArray(data?.users) ? data.users : [])
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : '用户搜索失败')
    } finally {
      setSearching(false)
    }
  }

  function selectUser(user: RewardUser) {
    setSelectedUser(user)
    setQuery('')
    setSearchResults([])
    setMessage('')
    setError('')
  }

  function openConfirm(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    setError('')
    if (!selectedUser) {
      setError('请先搜索并选择用户')
      return
    }
    try {
      const nextExperience = readAmount(experienceAmount, '奖励经验值')
      const nextRegistrationFee = readAmount(registrationFeeAmount, '奖励挂号费')
      const nextReason = reason.trim()
      if (!nextReason) throw new Error('奖励说明不能为空')
      if (nextExperience === 0 && nextRegistrationFee === 0) throw new Error('经验值和挂号费至少需要填写一项')
      setTransactionId(createTransactionId())
      setConfirmDraft({
        user: selectedUser,
        experienceAmount: nextExperience,
        registrationFeeAmount: nextRegistrationFee,
        reason: nextReason,
      })
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : '请检查奖励填写内容')
    }
  }

  async function loadHistory(nextPage = historyPage) {
    setHistoryLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(USER_REWARD_PAGE_SIZE) })
    if (historyUserQuery.trim()) params.set('q', historyUserQuery.trim())
    if (historyOperatorId) params.set('operatorId', historyOperatorId)
    if (historyFrom) params.set('from', historyFrom)
    if (historyTo) params.set('to', historyTo)
    try {
      const response = await fetch(`/api/admin/user-rewards?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as HistoryPayload & { message?: string }
      if (!response.ok) throw new Error(data?.message || '奖励记录加载失败')
      setHistory(Array.isArray(data.items) ? data.items : [])
      setHistoryPage(Number(data.page || nextPage))
      setHistoryTotal(Number(data.total || 0))
      setHistoryTotalPages(Math.max(1, Number(data.totalPages || 1)))
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : '奖励记录加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  function applyHistoryFilters() {
    setHistoryPage(1)
    void loadHistory(1)
  }

  async function submitReward() {
    if (!confirmDraft || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/admin/user-rewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          userId: confirmDraft.user.id,
          experienceAmount: confirmDraft.experienceAmount,
          registrationFeeAmount: confirmDraft.registrationFeeAmount,
          reason: confirmDraft.reason,
        }),
      })
      const data = await response.json().catch(() => null) as { message?: string; user?: RewardUser } | null
      if (!response.ok) throw new Error(data?.message || '奖励发放失败')
      if (data?.user) setSelectedUser(data.user)
      setConfirmDraft(null)
      setTransactionId('')
      setExperienceAmount('0')
      setRegistrationFeeAmount('0')
      setReason('')
      setMessage(data?.message || '奖励发放成功')
      await loadHistory(historyPage)
    } catch (submitError) {
      // Keep the same transactionId and draft in the dialog so a network
      // retry is idempotent instead of creating a new reward.
      setError(submitError instanceof Error ? submitError.message : '奖励发放失败')
    } finally {
      setSubmitting(false)
    }
  }

  const confirmationText = confirmDraft
    ? [
        `用户：${confirmDraft.user.displayName}`,
        `用户名：${confirmDraft.user.username}`,
        `用户 ID：${confirmDraft.user.id}`,
        `UID：${formatUid(confirmDraft.user.uid)}`,
        '',
        '获得奖励：',
        ...rewardLines(confirmDraft),
        '',
        `奖励说明：${confirmDraft.reason}`,
        error ? `\n${error}` : '',
      ].join('\n')
    : ''

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Contribution Rewards</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">用户奖励</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
          用户的投稿、建议或内容被采纳后，可在这里记录并发放经验值和挂号费。操作会留下独立奖励记录与流水，且不受普通每日获取规则影响。
        </p>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error && !confirmDraft ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}

      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Step 1</p>
          <h2 className="mt-1 text-2xl font-black text-brand-950">搜索并确认用户</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">支持用户名、用户 ID、UID、手机号和邮箱。</p>
        </div>
        <form onSubmit={searchUsers} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="用户名 / 用户 ID / UID / 手机号 / 邮箱"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-4 text-sm font-bold outline-none focus:border-brand-300"
          />
          <button type="submit" disabled={searching || !query.trim()} className="min-h-11 rounded-xl bg-brand-700 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
            {searching ? '搜索中...' : '搜索用户'}
          </button>
        </form>

        {searchResults.length ? (
          <div className="mt-4 grid gap-2">
            {searchResults.map((user) => (
              <button key={user.id} type="button" onClick={() => selectUser(user)} className="flex w-full items-center gap-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-left transition hover:border-sky-300 hover:bg-sky-50">
                <Avatar user={user} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-brand-950">{user.displayName}</span>
                  <span className="mt-1 block truncate text-xs font-bold text-slate-500">用户名：{user.username} · UID {formatUid(user.uid)}</span>
                  <span className="mt-1 block truncate text-xs font-bold text-slate-400">{user.phone || '未绑定手机'} · {user.email || '未绑定邮箱'}</span>
                </span>
                <span className="hidden shrink-0 text-right text-xs font-black text-slate-500 sm:block">经验 {user.experience}<br />挂号费 {user.points}</span>
              </button>
            ))}
          </div>
        ) : query.trim() && !searching ? <p className="mt-4 rounded-xl bg-sky-50 p-4 text-sm font-bold text-slate-500">没有找到匹配的有效用户。</p> : null}

        {selectedUser ? (
          <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50/55 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Avatar user={selectedUser} size="size-16" />
              <div className="min-w-0 flex-1">
                <p className="text-xl font-black text-brand-950">{selectedUser.displayName}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">用户名：{selectedUser.username} · 用户 ID：{selectedUser.id} · UID {formatUid(selectedUser.uid)}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">{selectedUser.phone || '未绑定手机'} · {selectedUser.email || '未绑定邮箱'}</p>
              </div>
              <button type="button" onClick={() => setSelectedUser(null)} className="min-h-10 rounded-full border border-sky-200 bg-white px-4 text-sm font-black text-brand-700">重新选择</button>
            </div>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-white/80 p-3"><dt className="text-xs font-black text-slate-500">当前经验值</dt><dd className="mt-1 text-2xl font-black text-brand-950">{selectedUser.experience}</dd></div>
              <div className="rounded-xl bg-white/80 p-3"><dt className="text-xs font-black text-slate-500">当前挂号费</dt><dd className="mt-1 text-2xl font-black text-brand-950">{selectedUser.points}</dd></div>
            </dl>
          </div>
        ) : null}
      </section>

      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Step 2</p>
        <h2 className="mt-1 text-2xl font-black text-brand-950">填写奖励</h2>
        <form onSubmit={openConfirm} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-black text-slate-700">
              奖励经验值
              <input type="number" min={0} max={USER_REWARD_MAX_AMOUNT} step={1} inputMode="numeric" value={experienceAmount} onChange={(event) => setExperienceAmount(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold outline-none focus:border-brand-300" />
              <span className="mt-1 block text-xs font-bold text-slate-400">可填 0；允许任意合理的正整数。</span>
            </label>
            <label className="block text-sm font-black text-slate-700">
              奖励挂号费
              <input type="number" min={0} max={USER_REWARD_MAX_AMOUNT} step={1} inputMode="numeric" value={registrationFeeAmount} onChange={(event) => setRegistrationFeeAmount(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold outline-none focus:border-brand-300" />
              <span className="mt-1 block text-xs font-bold text-slate-400">可填 0；不会消耗普通获取额度。</span>
            </label>
          </div>
          <label className="block text-sm font-black text-slate-700">
            奖励说明 <span className="text-red-500">*</span>
            <textarea required value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} className="mt-2 min-h-28 w-full rounded-xl border border-sky-100 bg-white px-3 py-3 text-sm font-bold leading-6 outline-none focus:border-brand-300" placeholder="例如：投稿内容已被采纳" />
            <span className="mt-1 block text-xs font-bold text-slate-400">该说明会进入奖励记录、挂号费流水和用户通知中心。</span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sky-100 pt-4">
            <p className="text-xs font-bold text-slate-500">经验值和挂号费可以单独或同时奖励，但不能同时为 0。</p>
            <button type="submit" disabled={!selectedUser || submitting} className="min-h-11 rounded-xl bg-brand-950 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">发放奖励</button>
          </div>
        </form>
      </section>

      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Audit History</p>
            <h2 className="mt-1 text-2xl font-black text-brand-950">奖励历史记录</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[220px_180px_150px_150px_auto]">
            <input value={historyUserQuery} onChange={(event) => setHistoryUserQuery(event.target.value)} placeholder="按用户 / UID 查询" className="min-h-10 rounded-xl border border-sky-100 px-3 text-sm font-bold outline-none" />
            <select value={historyOperatorId} onChange={(event) => setHistoryOperatorId(event.target.value)} className="min-h-10 rounded-xl border border-sky-100 px-3 text-sm font-bold outline-none"><option value="">全部操作管理员</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name} · {formatUid(operator.uid)}</option>)}</select>
            <input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} aria-label="开始日期" className="min-h-10 rounded-xl border border-sky-100 px-3 text-sm font-bold outline-none" />
            <input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} aria-label="结束日期" className="min-h-10 rounded-xl border border-sky-100 px-3 text-sm font-bold outline-none" />
            <button type="button" onClick={applyHistoryFilters} disabled={historyLoading} className="min-h-10 rounded-xl bg-brand-700 px-4 text-sm font-black text-white disabled:opacity-50">筛选</button>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[900px] w-full border-separate border-spacing-y-2 text-left text-sm">
            <thead className="text-xs font-black text-slate-400"><tr><th className="px-3 py-2">用户</th><th className="px-3 py-2">经验值</th><th className="px-3 py-2">挂号费</th><th className="px-3 py-2">奖励说明</th><th className="px-3 py-2">操作人</th><th className="px-3 py-2">发放时间</th></tr></thead>
            <tbody>
              {historyLoading ? <tr><td colSpan={6} className="rounded-xl bg-sky-50 px-4 py-8 text-center font-bold text-slate-500">加载中...</td></tr> : history.length ? history.map((item) => (
                <tr key={item.rewardId} className="bg-white shadow-sm"><td className="rounded-l-xl px-3 py-3"><p className="font-black text-brand-950">{item.username}</p><p className="mt-1 text-xs font-bold text-slate-500">UID {formatUid(item.userUid)}</p></td><td className="px-3 py-3 font-black text-emerald-700">{item.experienceAmount > 0 ? `+${item.experienceAmount}` : '—'}</td><td className="px-3 py-3 font-black text-emerald-700">{item.registrationFeeAmount > 0 ? `+${item.registrationFeeAmount}` : '—'}</td><td className="max-w-xs whitespace-pre-wrap px-3 py-3 font-bold text-slate-600">{item.reason}</td><td className="px-3 py-3 font-bold text-slate-600">{item.operatorName}</td><td className="rounded-r-xl px-3 py-3 font-bold text-slate-500">{formatTime(item.createdAt)}</td></tr>
              )) : <tr><td colSpan={6} className="rounded-xl bg-sky-50 px-4 py-8 text-center font-bold text-slate-500">暂无匹配的奖励记录。</td></tr>}
            </tbody>
          </table>
        </div>
        {historyTotal > USER_REWARD_PAGE_SIZE ? <Pagination currentPage={historyPage} totalPages={historyTotalPages} onPageChange={(page) => { setHistoryPage(page); void loadHistory(page) }} disabled={historyLoading} ariaLabel="奖励记录分页" className="mt-4" /> : null}
      </section>

      <ConfirmDialog
        open={Boolean(confirmDraft)}
        title="确认发放奖励？"
        description={confirmationText}
        confirmLabel="确认发放"
        cancelLabel="取消"
        loading={submitting}
        onConfirm={() => void submitReward()}
        onCancel={() => {
          if (!submitting) {
            setConfirmDraft(null)
            setTransactionId('')
            setError('')
          }
        }}
      />
    </div>
  )
}
