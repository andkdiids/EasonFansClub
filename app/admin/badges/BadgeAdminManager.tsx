'use client'

import { useMemo, useState } from 'react'
import type { BadgeEffectType, BadgeGrantType, BadgeNicknameEffect, BadgeRarity, BadgeVisibility } from '@/lib/badge-types'
import { BADGE_EFFECT_TYPE_LABELS, BADGE_GRANT_TYPE_LABELS, BADGE_NICKNAME_EFFECT_LABELS, BADGE_RARITY_LABELS, BADGE_VISIBILITY_LABELS } from '@/lib/badge-types'

export type AdminBadge = {
  id: string
  name: string
  code: string
  slug: string
  description: string | null
  acquisitionDescription: string | null
  iconUrl: string | null
  category: string
  visibility: BadgeVisibility
  rarity: BadgeRarity
  grantType: BadgeGrantType
  isWearable: boolean
  isEnabled: boolean
  effectType: BadgeEffectType
  nicknameEffect: BadgeNicknameEffect
  nicknameColor: string | null
  nicknameGradientStart: string | null
  nicknameGradientEnd: string | null
  sortOrder: number
  ownerCount: number
  createdAt: string
}

type BadgeDraft = Omit<AdminBadge, 'id' | 'ownerCount' | 'createdAt' | 'isEnabled'> & { id?: string; isEnabled: boolean; imageUrl?: string | null }

const emptyDraft: BadgeDraft = {
  name: '', code: '', slug: '', description: '', acquisitionDescription: '', iconUrl: null, imageUrl: null, category: 'SYSTEM', visibility: 'PUBLIC', rarity: 'COMMON', grantType: 'MANUAL', isWearable: true, isEnabled: true, effectType: 'NONE', nicknameEffect: 'NONE', nicknameColor: '', nicknameGradientStart: '', nicknameGradientEnd: '', sortOrder: 0,
}

function toDraft(badge: AdminBadge): BadgeDraft {
  return { ...badge, imageUrl: badge.iconUrl }
}

function formatDate(value: string) { return new Date(value).toLocaleDateString('zh-CN') }

export function BadgeAdminManager({ initialBadges }: { initialBadges: AdminBadge[] }) {
  const [badges, setBadges] = useState(initialBadges)
  const [draft, setDraft] = useState<BadgeDraft | null>(null)
  const [query, setQuery] = useState('')
  const [filterVisibility, setFilterVisibility] = useState('')
  const [filterEnabled, setFilterEnabled] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [ownersBadge, setOwnersBadge] = useState<AdminBadge | null>(null)
  const [owners, setOwners] = useState<Array<{ id: string; obtainedAt: string; grantReason: string | null; user: { uid: number; displayName: string } }>>([])
  const [grantBadgeTarget, setGrantBadgeTarget] = useState<AdminBadge | null>(null)
  const [grantQuery, setGrantQuery] = useState('')
  const [grantUsers, setGrantUsers] = useState<Array<{ id: string; uid: number; displayName: string }>>([])
  const [grantUserId, setGrantUserId] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [busy, setBusy] = useState(false)

  const visibleBadges = useMemo(() => badges.filter((badge) => {
    const matchesQuery = !query.trim() || `${badge.name} ${badge.code}`.toLowerCase().includes(query.trim().toLowerCase())
    const matchesVisibility = !filterVisibility || badge.visibility === filterVisibility
    const matchesEnabled = !filterEnabled || (filterEnabled === 'true' ? badge.isEnabled : !badge.isEnabled)
    return matchesQuery && matchesVisibility && matchesEnabled
  }), [badges, filterEnabled, filterVisibility, query])

  async function reload() {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (filterVisibility) params.set('visibility', filterVisibility)
    if (filterEnabled) params.set('enabled', filterEnabled)
    const response = await fetch(`/api/admin/badges?${params}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { badges?: AdminBadge[]; message?: string } | null
    if (!response.ok || !data?.badges) throw new Error(data?.message || '勋章列表加载失败')
    setBadges(data.badges)
  }

  function notify(nextMessage: string) { setMessage(nextMessage); setError('') }
  function fail(nextError: string) { setError(nextError); setMessage('') }

  async function saveDraft(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    setBusy(true)
    try {
      const response = await fetch(draft.id ? `/api/admin/badges/${draft.id}` : '/api/admin/badges', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, imageUrl: draft.imageUrl || draft.iconUrl || null }),
      })
      const data = await response.json().catch(() => null) as { badge?: AdminBadge; message?: string } | null
      if (!response.ok || !data?.badge) throw new Error(data?.message || '保存失败')
      setDraft(null)
      notify(draft.id ? '勋章已更新' : '勋章已创建')
      await reload()
    } catch (saveError) { fail(saveError instanceof Error ? saveError.message : '保存失败') } finally { setBusy(false) }
  }

  async function uploadPng(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/admin/badges/upload', { method: 'POST', body: form })
      const data = await response.json().catch(() => null) as { url?: string; message?: string } | null
      if (!response.ok || !data?.url) throw new Error(data?.message || 'PNG 上传失败')
      setDraft((current) => current ? { ...current, iconUrl: data.url || null, imageUrl: data.url || null } : current)
      notify('PNG 已上传，保存勋章后正式关联')
    } catch (uploadError) { fail(uploadError instanceof Error ? uploadError.message : 'PNG 上传失败') } finally { setUploading(false) }
  }

  async function toggleBadge(badge: AdminBadge) {
    try {
      const response = await fetch(`/api/admin/badges/${badge.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isEnabled: !badge.isEnabled }) })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '状态更新失败')
      notify(badge.isEnabled ? '勋章已停用，当前佩戴已自动取消' : '勋章已启用')
      await reload()
    } catch (toggleError) { fail(toggleError instanceof Error ? toggleError.message : '状态更新失败') }
  }

  async function deleteBadge(badge: AdminBadge) {
    if (!window.confirm(`确认删除「${badge.name}」吗？已有用户获得时会被阻止删除。`)) return
    const response = await fetch(`/api/admin/badges/${badge.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null) as { message?: string } | null
    if (!response.ok) return fail(data?.message || '删除失败')
    notify('勋章已删除')
    await reload()
  }

  async function loadOwners(badge: AdminBadge) {
    setOwnersBadge(badge)
    const response = await fetch(`/api/admin/badges/${badge.id}/owners`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { owners?: typeof owners; message?: string } | null
    if (!response.ok || !data?.owners) return fail(data?.message || '获得用户加载失败')
    setOwners(data.owners)
  }

  async function searchGrantUsers() {
    if (!grantQuery.trim()) return setGrantUsers([])
    const response = await fetch(`/api/admin/badges/users?q=${encodeURIComponent(grantQuery.trim())}`, { cache: 'no-store' })
    const data = await response.json().catch(() => null) as { users?: typeof grantUsers; message?: string } | null
    if (!response.ok || !data?.users) return fail(data?.message || '用户搜索失败')
    setGrantUsers(data.users)
  }

  async function grantSelected() {
    if (!grantBadgeTarget || !grantUserId) return fail('请选择目标用户')
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/badges/${grantBadgeTarget.id}/grant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: grantUserId, grantReason, sourceType: 'MANUAL' }) })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '发放失败')
      notify('勋章已发放并记录管理员操作日志')
      setGrantBadgeTarget(null)
      await reload()
    } catch (grantError) { fail(grantError instanceof Error ? grantError.message : '发放失败') } finally { setBusy(false) }
  }

  async function revokeOwner(owner: (typeof owners)[number]) {
    if (!ownersBadge) return
    if (!window.confirm(`确认收回 ${owner.user.displayName} 的「${ownersBadge.name}」吗？`)) return
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/badges/${ownersBadge.id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: owner.user.uid, reason: '管理员在勋章管理中收回' }),
      })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '收回失败')
      setOwners((current) => current.filter((item) => item.id !== owner.id))
      notify('勋章已收回，若正在佩戴也已同步取消')
      await reload()
    } catch (revokeError) { fail(revokeError instanceof Error ? revokeError.message : '收回失败') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
      <section className="rounded-[24px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-48 flex-1 text-xs font-black text-slate-500">搜索勋章<input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void reload() }} placeholder="名称或 code" className="mt-1 min-h-10 w-full rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950" /></label>
          <label className="text-xs font-black text-slate-500">状态<select value={filterEnabled} onChange={(event) => { setFilterEnabled(event.target.value); void reload() }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部</option><option value="true">启用</option><option value="false">停用</option></select></label>
          <label className="text-xs font-black text-slate-500">可见性<select value={filterVisibility} onChange={(event) => { setFilterVisibility(event.target.value); void reload() }} className="mt-1 min-h-10 rounded-xl border border-sky-200 px-3 text-sm font-bold text-brand-950"><option value="">全部</option>{Object.entries(BADGE_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button type="button" onClick={() => setDraft({ ...emptyDraft })} className="min-h-10 rounded-xl bg-brand-950 px-4 text-sm font-black text-white">新增勋章</button>
        </div>
      </section>

      {draft ? <form onSubmit={saveDraft} className="rounded-[24px] border border-sky-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">{draft.id ? '编辑勋章' : '新增勋章'}</h2><button type="button" onClick={() => setDraft(null)} className="text-sm font-black text-slate-500">取消</button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-black text-slate-500">勋章名称<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="admin-badge-input" /></label>
          <label className="text-xs font-black text-slate-500">唯一 code<input required pattern="[a-z0-9][a-z0-9_-]{1,63}" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} className="admin-badge-input" /></label>
          {!draft.id ? <label className="text-xs font-black text-slate-500">slug（可留空，默认使用 code）<input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} className="admin-badge-input" /></label> : null}
          <label className="text-xs font-black text-slate-500">排序<input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className="admin-badge-input" /></label>
          <label className="text-xs font-black text-slate-500 md:col-span-2">勋章简介<textarea value={draft.description || ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="admin-badge-input min-h-20" /></label>
          <label className="text-xs font-black text-slate-500 md:col-span-2">获取方式<textarea value={draft.acquisitionDescription || ''} onChange={(event) => setDraft({ ...draft, acquisitionDescription: event.target.value })} className="admin-badge-input min-h-20" /></label>
          <label className="text-xs font-black text-slate-500">可见性<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as BadgeVisibility })} className="admin-badge-input">{Object.entries(BADGE_VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">稀有度<select value={draft.rarity} onChange={(event) => setDraft({ ...draft, rarity: event.target.value as BadgeRarity })} className="admin-badge-input">{Object.entries(BADGE_RARITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">发放类型<select value={draft.grantType} onChange={(event) => setDraft({ ...draft, grantType: event.target.value as BadgeGrantType })} className="admin-badge-input">{Object.entries(BADGE_GRANT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">动画效果<select value={draft.effectType} onChange={(event) => setDraft({ ...draft, effectType: event.target.value as BadgeEffectType })} className="admin-badge-input">{Object.entries(BADGE_EFFECT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-black text-slate-500">昵称效果<select value={draft.nicknameEffect} onChange={(event) => setDraft({ ...draft, nicknameEffect: event.target.value as BadgeNicknameEffect })} className="admin-badge-input">{Object.entries(BADGE_NICKNAME_EFFECT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {draft.nicknameEffect === 'COLOR' ? <label className="text-xs font-black text-slate-500">昵称颜色<input type="color" value={draft.nicknameColor || '#0f5f78'} onChange={(event) => setDraft({ ...draft, nicknameColor: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-sky-200 p-1" /></label> : null}
          {draft.nicknameEffect === 'GRADIENT' ? <><label className="text-xs font-black text-slate-500">渐变起始颜色<input type="color" value={draft.nicknameGradientStart || '#0f5f78'} onChange={(event) => setDraft({ ...draft, nicknameGradientStart: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-sky-200 p-1" /></label><label className="text-xs font-black text-slate-500">渐变结束颜色<input type="color" value={draft.nicknameGradientEnd || '#7c3aed'} onChange={(event) => setDraft({ ...draft, nicknameGradientEnd: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-sky-200 p-1" /></label></> : null}
          <label className="text-xs font-black text-slate-500 md:col-span-2">PNG 图片<input type="file" accept="image/png" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPng(file) }} className="mt-1 block w-full text-sm font-bold" />{uploading ? <span className="mt-1 block text-xs text-slate-500">上传中…</span> : null}{draft.imageUrl || draft.iconUrl ? <span className="mt-1 block text-xs font-bold text-emerald-700">已关联 PNG</span> : <span className="mt-1 block text-xs font-bold text-slate-400">建议 256×256 或 512×512，最大 2MB</span>}</label>
          <label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.isWearable} onChange={(event) => setDraft({ ...draft, isWearable: event.target.checked })} />允许用户佩戴</label>
          <label className="flex items-center gap-2 text-sm font-black text-brand-950"><input type="checkbox" checked={draft.isEnabled} onChange={(event) => setDraft({ ...draft, isEnabled: event.target.checked })} />启用勋章</label>
        </div>
        <button type="submit" disabled={busy || uploading} className="mt-5 min-h-11 rounded-xl bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : '保存勋章'}</button>
      </form> : null}

      <section className="overflow-hidden rounded-[24px] border border-sky-100 bg-white/85 shadow-sm"><div className="divide-y divide-sky-100">{visibleBadges.map((badge) => <article key={badge.id} className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-sky-50">{badge.iconUrl ? <img src={badge.iconUrl} alt={badge.name} className="h-12 w-12 object-contain" /> : <span className="text-2xl">🏅</span>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-black text-brand-950">{badge.name}</h2><span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-brand-700">{badge.code}</span><span className={`rounded-full px-2 py-1 text-[10px] font-black ${badge.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{badge.isEnabled ? '启用' : '停用'}</span></div><p className="mt-1 text-xs font-bold text-slate-500">{BADGE_VISIBILITY_LABELS[badge.visibility]} · {BADGE_RARITY_LABELS[badge.rarity]} · {BADGE_GRANT_TYPE_LABELS[badge.grantType]} · 已获得 {badge.ownerCount} 人 · 创建于 {formatDate(badge.createdAt)}</p><p className="mt-1 line-clamp-2 text-xs font-bold text-slate-500">{badge.description || '暂无简介'}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDraft(toDraft(badge))} className="admin-badge-list-button">编辑</button><button type="button" onClick={() => void toggleBadge(badge)} className="admin-badge-list-button">{badge.isEnabled ? '停用' : '启用'}</button><button type="button" onClick={() => { setGrantBadgeTarget(badge); setGrantUsers([]); setGrantUserId('') }} className="admin-badge-list-button">发放</button><button type="button" onClick={() => void loadOwners(badge)} className="admin-badge-list-button">获得用户</button><button type="button" onClick={() => void deleteBadge(badge)} className="admin-badge-list-button danger">删除</button></div></article>)}</div>{!visibleBadges.length ? <p className="p-8 text-center text-sm font-bold text-slate-500">没有符合条件的勋章。</p> : null}</section>

      {ownersBadge ? <div className="badge-detail-backdrop" role="presentation" onMouseDown={() => setOwnersBadge(null)}><section className="badge-admin-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setOwnersBadge(null)} className="float-right text-2xl text-slate-500" aria-label="关闭">×</button><h2 className="text-xl font-black text-brand-950">{ownersBadge.name} · 获得用户</h2><p className="mt-1 text-xs font-bold text-slate-500">共 {owners.length} 人</p><div className="mt-4 max-h-80 space-y-2 overflow-auto">{owners.map((owner) => <div key={owner.id} className="flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-3 py-2 text-sm"><span className="font-black text-brand-950">{owner.user.displayName} <small className="text-slate-500">UID {owner.user.uid}</small></span><span className="flex items-center gap-2 text-right text-[11px] font-bold text-slate-500"><span>{formatDate(owner.obtainedAt)}{owner.grantReason ? <><br />{owner.grantReason}</> : null}</span><button type="button" onClick={() => void revokeOwner(owner)} disabled={busy} className="admin-badge-list-button danger">收回</button></span></div>)}</div></section></div> : null}
      {grantBadgeTarget ? <div className="badge-detail-backdrop" role="presentation" onMouseDown={() => setGrantBadgeTarget(null)}><section className="badge-admin-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setGrantBadgeTarget(null)} className="float-right text-2xl text-slate-500" aria-label="关闭">×</button><h2 className="text-xl font-black text-brand-950">发放「{grantBadgeTarget.name}」</h2><div className="mt-4 flex gap-2"><input value={grantQuery} onChange={(event) => setGrantQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchGrantUsers() } }} placeholder="昵称 / UID / 登录账号" className="admin-badge-input" /><button type="button" onClick={() => void searchGrantUsers()} className="admin-badge-list-button">搜索</button></div><div className="mt-2 space-y-1">{grantUsers.map((user) => <button type="button" key={user.id} onClick={() => setGrantUserId(user.id)} className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-black ${grantUserId === user.id ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-950'}`}>{user.displayName} · UID {user.uid}</button>)}</div><textarea value={grantReason} onChange={(event) => setGrantReason(event.target.value)} placeholder="发放原因（可选）" className="admin-badge-input mt-3 min-h-20" /><button type="button" onClick={() => void grantSelected()} disabled={busy || !grantUserId} className="mt-3 min-h-10 rounded-xl bg-brand-950 px-4 text-sm font-black text-white disabled:opacity-50">{busy ? '发放中…' : '确认发放'}</button></section></div> : null}
    </div>
  )
}
