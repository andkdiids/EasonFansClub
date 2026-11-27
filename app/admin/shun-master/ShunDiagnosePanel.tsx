'use client'

import { useState } from 'react'

type Diagnosis = {
  found: boolean
  uid?: number
  eligible?: boolean
  inGlobalPool?: boolean
  exclusionReasons?: string[]
  victimCap?: number
  receivedToday?: number
  receivedEver?: number
  permanentlyOptedOut?: boolean
  hasSpendableBalance?: boolean
  activityTier?: number
  activeDays?: number
  configFellBack?: boolean
  actor?: {
    found: boolean
    friendRecognized: boolean
    friendshipCreatedAt?: string
    actorBlockedByTarget?: boolean
    relatedAccountsExcluded?: boolean
    matchedToday?: number
    friendPoolSize: number
    friendChance: number
    fallbackReason: string | null
  } | null
}

const REASON_LABELS: Record<string, string> = {
  ACCOUNT_NOT_ACTIVE: '账号状态非 ACTIVE',
  ACCOUNT_DELETED: '账号已删除',
  PERMANENT_OPT_OUT: '已永久退出顺大师',
  NO_PROFILE: '没有资料页（Profile）',
  ZERO_BALANCE: '挂号费余额 ≤ 0',
  DAILY_VICTIM_CAP_REACHED: '当日被顺次数已达上限',
  ACTOR_NOT_FOUND: '发起人 UID 不存在',
  FRIEND_CHANCE_OFF: '好友命中概率为 0（好友池未启用）',
  NO_FRIENDS: '发起人没有任何「已接受」好友',
  POOL_EMPTY_AFTER_FILTERS: '好友存在，但全部被资格规则排除（账户状态/余额/上限/拉黑/关联账号/当日已顺）',
  DICE_LOSS: '好友池非空，但概率掷骰未命中（当前概率 < 100%）',
}

const FALLBACK_LABELS: Record<string, string> = {
  FRIEND_CHANCE_OFF: '好友概率为 0，直接使用全站池',
  NO_FRIENDS: '没有好友，回退全站池',
  POOL_EMPTY_AFTER_FILTERS: '好友全被资格规则排除，回退全站池',
  DICE_LOSS: '好友池非空但概率未命中，按全站规则抽取',
}

function Bool({ value }: { value: boolean | undefined }) {
  if (value === undefined) return <span>—</span>
  return <b style={{ color: value ? 'var(--primary, #16a34a)' : 'var(--danger, #dc2626)' }}>{value ? '是' : '否'}</b>
}

/**
 * Read-only admin diagnosis. Never renders another user's email/phone — the
 * API only returns booleans, enum reasons and counters.
 */
export function ShunDiagnosePanel() {
  const [uid, setUid] = useState('')
  const [actorUid, setActorUid] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Diagnosis | null>(null)

  async function run() {
    const parsed = Number(uid.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) { setError('请输入有效的被查 UID。'); return }
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ uid: String(parsed) })
      if (actorUid.trim()) params.set('actorUid', actorUid.trim())
      const response = await fetch(`/api/admin/shun-master/diagnose?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json().catch(() => null) as { ok?: boolean; diagnosis?: Diagnosis; message?: string }
      if (!response.ok || !body?.ok) throw new Error(body?.message || '诊断查询失败。')
      setResult(body.diagnosis ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '诊断查询失败。')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <details open><summary>候选池诊断（只读）</summary>
      <div className="flex flex-wrap items-end gap-2 py-2">
        <label className="text-sm">被查 UID
          <input className="ml-1 w-28 border px-2 py-1" inputMode="numeric" value={uid}
            onChange={(event) => setUid(event.target.value)} placeholder="如 2" />
        </label>
        <label className="text-sm">发起人 UID（可选，诊断好友池）
          <input className="ml-1 w-28 border px-2 py-1" inputMode="numeric" value={actorUid}
            onChange={(event) => setActorUid(event.target.value)} placeholder="如 1" />
        </label>
        <button className="border px-3 py-1" type="button" disabled={loading} onClick={() => void run()}>
          {loading ? '查询中…' : '诊断'}
        </button>
      </div>
      {error ? <p className="text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{error}</p> : null}
      {result && !result.found ? <p className="text-sm">该 UID 不存在。</p> : null}
      {result?.found ? (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border text-left text-sm">
            <tbody>
              <tr className="border-t"><th className="p-2">UID</th><td className="p-2">{result.uid}</td></tr>
              <tr className="border-t"><th className="p-2">当前可被顺（全部资格通过）</th><td className="p-2"><Bool value={result.eligible} /></td></tr>
              <tr className="border-t"><th className="p-2">在全站候选池中</th><td className="p-2"><Bool value={result.inGlobalPool} /></td></tr>
              <tr className="border-t"><th className="p-2">不符合资格的原因</th>
                <td className="p-2">{result.exclusionReasons?.length
                  ? <ul>{result.exclusionReasons.map((reason) => <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>)}</ul>
                  : '无'}</td></tr>
              <tr className="border-t"><th className="p-2">今日被顺 / 上限</th><td className="p-2">{result.receivedToday} / {result.victimCap}</td></tr>
              <tr className="border-t"><th className="p-2">历史累计被顺</th><td className="p-2">{result.receivedEver}</td></tr>
              <tr className="border-t"><th className="p-2">永久退出</th><td className="p-2"><Bool value={result.permanentlyOptedOut} /></td></tr>
              <tr className="border-t"><th className="p-2">挂号费余额 &gt; 0</th><td className="p-2"><Bool value={result.hasSpendableBalance} /></td></tr>
              <tr className="border-t"><th className="p-2">活跃度档位 / 近 7 天活跃天数</th><td className="p-2">{result.activityTier} / {result.activeDays}</td></tr>
              {result.configFellBack ? <tr className="border-t"><th className="p-2">⚠ 配置</th><td className="p-2">存储的配置未通过校验，当前实际使用默认配置（好友概率 20%）——请检查保存的配置 JSON。</td></tr> : null}
              {result.actor ? (
                <tr className="border-t"><th className="p-2">好友诊断（发起人视角）</th><td className="p-2">
                  {!result.actor.found ? '发起人 UID 不存在。' : (
                    <ul>
                      <li>互为好友：<Bool value={result.actor.friendRecognized} />{result.actor.friendshipCreatedAt ? `（建立于 ${result.actor.friendshipCreatedAt}）` : ''}</li>
                      <li>存在拉黑：<Bool value={Boolean(result.actor.actorBlockedByTarget)} /></li>
                      <li>命中关联账号排除（同已验证邮箱/手机号）：<Bool value={Boolean(result.actor.relatedAccountsExcluded)} /></li>
                      <li>发起人今日已顺过该用户：<Bool value={(result.actor.matchedToday ?? 0) > 0} /></li>
                      <li>后台好友命中概率：{result.actor.friendChance}%</li>
                      <li>发起人好友候选池大小：{result.actor.friendPoolSize}</li>
                      <li>好友池回退原因：{result.actor.fallbackReason ? (FALLBACK_LABELS[result.actor.fallbackReason] ?? result.actor.fallbackReason) : '无（好友池可用）'}</li>
                    </ul>
                  )}
                </td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  )
}
