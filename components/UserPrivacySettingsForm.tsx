'use client'

import { useState } from 'react'
import {
  USER_PRIVACY_KEYS,
  type UserPrivacyKey,
  type UserPrivacySettings,
} from '@/lib/user-privacy-types'

type Props = { initialSettings: UserPrivacySettings }

const sections: Array<{ title: string; items: Array<{ key: UserPrivacyKey; label: string; description: string }> }> = [
  {
    title: '个人记录',
    items: [
      { key: 'showCheckInHistory', label: '显示挂号记录', description: '允许其他用户查看你个人主页中的签到和挂号记录。' },
      { key: 'showCheckInMessages', label: '显示挂号留言', description: '允许其他用户查看你在个人主页中的历史挂号留言。' },
      { key: 'showPosts', label: '显示发帖记录', description: '允许其他用户从你的主页查看你发布过的帖子。' },
      { key: 'showComments', label: '显示评论记录', description: '允许其他用户从你的主页查看你的评论和回复记录。' },
    ],
  },
  {
    title: '娱乐与活动',
    items: [
      { key: 'showConcertHistory', label: '显示演唱会记录', description: '允许其他用户查看你的 My Live 和演唱会记录。' },
      { key: 'showActivityHistory', label: '显示活动记录', description: '允许其他用户查看你参加过的活动记录。' },
    ],
  },
  {
    title: '个人展示',
    items: [
      { key: 'showBadgeHistory', label: '显示勋章记录', description: '允许其他用户查看你个人主页中的完整勋章记录。' },
      { key: 'showRatings', label: '显示评分与榜单', description: '允许其他用户查看你个人主页中的评分和个人榜单。' },
    ],
  },
]

function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: () => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange} className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition ${checked ? 'bg-[var(--primary)]' : 'bg-slate-400'} disabled:cursor-wait disabled:opacity-60`}><span className={`h-6 w-6 rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-6' : 'translate-x-0'}`} /></button>
}

export function UserPrivacySettingsForm({ initialSettings }: Props) {
  const [settings, setSettings] = useState<UserPrivacySettings>(initialSettings)
  const [saving, setSaving] = useState<UserPrivacyKey | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function updateSetting(key: UserPrivacyKey) {
    if (saving) return
    const previous = settings[key]
    const next = !previous
    setSettings((current) => ({ ...current, [key]: next }))
    setSaving(key)
    setNotice('')
    setError('')
    try {
      const response = await fetch('/api/settings/privacy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ [key]: next }),
      })
      const data = await response.json().catch(() => null) as { privacy?: Partial<UserPrivacySettings>; message?: string } | null
      if (!response.ok || !data?.privacy) throw new Error(data?.message || '隐私设置保存失败，请稍后重试')
      setSettings((current) => ({ ...current, ...data.privacy }))
      setNotice('隐私设置已更新')
    } catch (saveError) {
      setSettings((current) => ({ ...current, [key]: previous }))
      setError(saveError instanceof Error ? saveError.message : '隐私设置保存失败，请稍后重试')
    } finally {
      setSaving(null)
    }
  }

  return <div className="mt-7 space-y-7">
    {sections.map((section) => <section key={section.title} aria-labelledby={`privacy-${section.title}`}>
      <h2 id={`privacy-${section.title}`} className="text-sm font-black tracking-[0.12em] text-[var(--primary)]">{section.title}</h2>
      <div className="mt-3 space-y-3">
        {section.items.map((item) => <div key={item.key} className="flex min-w-0 items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="break-words font-black text-[var(--foreground)]">{item.label}</p>
            <p className="mt-1 break-words text-xs font-bold leading-5 text-[var(--foreground-muted)]">{item.description}</p>
          </div>
          <Switch checked={settings[item.key]} disabled={saving !== null} label={`${item.label}${settings[item.key] ? '已开启' : '已关闭'}`} onChange={() => void updateSetting(item.key)} />
        </div>)}
      </div>
    </section>)}
    {notice ? <p role="status" className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm font-black text-[var(--success)]">{notice}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-black text-[var(--danger)]">{error}</p> : null}
    <p className="text-xs font-bold leading-6 text-[var(--foreground-muted)]">这些设置只控制其他用户从你的个人主页看到的记录，不会删除原有数据，也不会改变公开帖子、评论、报名或勋章本身的公开规则。</p>
    <span className="sr-only">{USER_PRIVACY_KEYS.length} 项隐私设置</span>
  </div>
}
