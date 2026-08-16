'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { clinicCategoryOptions, clinicIdentityOptions, clinicNeedOptions } from '@/lib/clinic-config'
import type { ClinicCategory, ClinicIdentityMode, ClinicNeedType } from '@prisma/client'

export function ClinicComposer({ isAuthenticated }: Readonly<{ isAuthenticated: boolean }>) {
  const router = useRouter()
  const [category, setCategory] = useState<ClinicCategory>('TREE_HOLE')
  const [needType, setNeedType] = useState<ClinicNeedType>('JUST_LISTEN')
  const [identityMode, setIdentityMode] = useState<ClinicIdentityMode>('PUBLIC')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent('/clinic/new')}`)
      return
    }
    if (saving) return
    setSaving(true)
    setError('')
    try {
      if (identityMode === 'ANONYMOUS' && !window.confirm('你正在匿名挂号。\n\n其他病友无法查看你的真实身份，管理员仍可在违规处理时查看。')) {
        setSaving(false)
        return
      }
      const response = await fetch('/api/clinic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, needType, identityMode, content }),
      })
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: { id?: string }; message?: string }
      if (!response.ok || !body?.ok || !body.data?.id) throw new Error(body?.message || '挂号失败，请稍后再试。')
      router.push(`/clinic/${body.data.id}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '挂号失败，请稍后再试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="clinic-page-shell clinic-new-page">
      <div className="clinic-detail-back"><Link href="/clinic">← 返回门诊部</Link></div>
      <header className="clinic-form-heading"><p className="clinic-kicker">NEW CLINIC RECORD</p><h1>我要挂号</h1><p>哪里不舒服？慢慢讲。</p></header>
      <section className="clinic-form-panel">
        <fieldset className="clinic-option-fieldset"><legend>1. 今日症状</legend><div className="clinic-option-grid">{clinicCategoryOptions.map((item) => <label key={item.value} className={category === item.value ? 'is-selected' : ''}><input type="radio" name="clinic-category" value={item.value} checked={category === item.value} onChange={() => setCategory(item.value)} /><span><b>{item.label}</b><small>{item.description}</small></span></label>)}</div></fieldset>
        <fieldset className="clinic-option-fieldset"><legend>2. 我现在需要</legend><div className="clinic-need-grid">{clinicNeedOptions.map((item) => <label key={item.value} className={needType === item.value ? 'is-selected' : ''}><input type="radio" name="clinic-need" value={item.value} checked={needType === item.value} onChange={() => setNeedType(item.value)} /><span>{item.label}</span></label>)}</div></fieldset>
        <fieldset className="clinic-option-fieldset"><legend>3. 身份</legend><div className="clinic-identity-options">{clinicIdentityOptions.map((item) => <label key={item.value} className={identityMode === item.value ? 'is-selected' : ''}><input type="radio" name="clinic-identity" value={item.value} checked={identityMode === item.value} onChange={() => setIdentityMode(item.value)} /><span><b>{item.label}</b>{item.value === 'ANONYMOUS' ? <small>普通病友无法看到你的真实身份。</small> : null}</span></label>)}</div></fieldset>
        <label className="clinic-field clinic-content-field"><span>4. 病情描述</span><textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} placeholder="今天发生什么了？" aria-label="病情描述" /><small>{content.length} / 2000</small></label>
        <p className="clinic-privacy-note">请勿公开手机号、住址、身份证、真实姓名等敏感个人信息。</p>
        {!isAuthenticated ? <p className="clinic-login-note">请先<Link href="/login?redirect=%2Fclinic%2Fnew">登录</Link>，再向病友挂号。</p> : null}
        {error ? <p className="clinic-form-error" role="alert">{error}</p> : null}
        <footer className="clinic-form-actions"><Link href="/clinic" className="clinic-secondary-button">取消</Link><button type="button" className="clinic-primary-button" disabled={saving} onClick={() => void submit()}>{saving ? '挂号中…' : identityMode === 'ANONYMOUS' ? '匿名挂号' : '公开挂号'}</button></footer>
      </section>
      <footer className="clinic-disclaimer">阿士匹灵门诊部是病友交流与情绪树洞，不提供专业医疗或心理诊断。如遇真实身体或心理健康问题，请及时寻求专业帮助。</footer>
    </main>
  )
}
