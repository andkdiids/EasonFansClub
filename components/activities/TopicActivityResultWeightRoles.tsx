'use client'

import type { TopicActivityV2TestResult } from '@/lib/topic-activity-v2-config'
import { setTopicActivityResultRole, TOPIC_ACTIVITY_RESULT_ROLES, topicActivityRoleAssignments, topicActivityRoleSummary, type TopicActivityResultRole } from '@/lib/topic-activity-result-weight-roles'

const inputClass = 'mt-1 min-h-10 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm'

export function TopicActivityResultWeightRoles({
  results,
  weights,
  disabled = false,
  onChange,
}: Readonly<{
  results: readonly TopicActivityV2TestResult[]
  weights: Record<string, number> | undefined
  disabled?: boolean
  onChange: (weights: Record<string, number>) => void
}>) {
  const assignments = topicActivityRoleAssignments(weights)
  const summary = topicActivityRoleSummary({ weights }, results)
  return <fieldset disabled={disabled} className="space-y-2 border border-[var(--border)] p-3" aria-label="结果权重">
    <legend className="px-1 text-sm font-semibold">结果权重</legend>
    <p className="text-xs text-[var(--foreground-muted)]" aria-live="polite">{summary.length ? `当前配置：${summary.join(' · ')}` : '当前配置：未配置结果权重'}</p>
    {!results.length ? <p className="text-sm text-[var(--foreground-muted)]">请先添加测试结果。</p> : <div className="grid gap-2 sm:grid-cols-3">
      {TOPIC_ACTIVITY_RESULT_ROLES.map((role) => {
        const selected = assignments[role.key as TopicActivityResultRole]
        return <label key={role.key} className="text-sm">{role.label}（+{role.points}）<select
          aria-label={`${role.label} +${role.points}`}
          className={inputClass}
          value={selected}
          onChange={(event) => onChange(setTopicActivityResultRole(weights, role.key, event.target.value))}
        >
          <option value="">不设置</option>
          {results.map((result) => <option key={result.id} value={result.id} disabled={Boolean(assignments.PRIMARY === result.id && role.key !== 'PRIMARY' || assignments.SECONDARY === result.id && role.key !== 'SECONDARY' || assignments.WEAK === result.id && role.key !== 'WEAK')}>
            {result.title || '未命名结果'}
          </option>)}
        </select></label>
      })}
    </div>}
  </fieldset>
}
