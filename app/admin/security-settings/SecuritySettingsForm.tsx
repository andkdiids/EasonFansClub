'use client'

import { useState } from 'react'
import type { AccountSecuritySettings } from '@/lib/account-security'

const labels: Record<keyof AccountSecuritySettings, { title: string; description: string }> = {
  requireSecurityQuestionsForNewUsers: { title: '新用户必须设置密保问题', description: '开启后注册必须完整填写一个密保问题和答案。' },
  notifyLegacyUsersToSetSecurityQuestions: { title: '通知历史用户补充密保', description: '登录成功后仅创建一条未完成通知。' },
  enableSecurityQuestionRecovery: { title: '启用密保问题找回', description: '控制忘记密码页面和接口是否提供密保方式。' },
  enableEmailPasswordReset: { title: '启用邮箱验证码重置密码', description: '默认关闭；开启后仍需邮件服务配置才能发送。' },
}

export function SecuritySettingsForm({ initial }: { initial: AccountSecuritySettings }) {
  const [settings, setSettings] = useState(initial)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true); setMessage(''); setError('')
    const response = await fetch('/api/admin/security-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(settings) })
    const data = await response.json().catch(() => ({})); setSaving(false)
    if (!response.ok) { setError(data.message || '保存失败'); return }
    setMessage(data.message || '保存成功')
  }
  return <section className="rounded-[28px] border border-sky-100 bg-white p-6 shadow-sm">
    <div className="space-y-3">{(Object.keys(labels) as (keyof AccountSecuritySettings)[]).map((key) => <label key={key} className="flex items-start gap-4 rounded-2xl bg-sky-50/60 p-4"><input type="checkbox" checked={settings[key]} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))} className="mt-1 size-5" /><span><span className="block font-black text-brand-950">{labels[key].title}</span><span className="mt-1 block text-sm font-bold leading-6 text-slate-500">{labels[key].description}</span></span></label>)}</div>
    {message ? <p className="mt-4 text-sm font-black text-emerald-700">{message}</p> : null}{error ? <p className="mt-4 text-sm font-black text-red-700">{error}</p> : null}
    <button onClick={save} disabled={saving} className="mt-5 w-full rounded-2xl bg-brand-950 px-5 py-3 font-black text-white disabled:opacity-50">{saving ? '保存中...' : '保存账户安全设置'}</button>
  </section>
}
