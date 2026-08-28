'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ActivityDetailView } from '@/components/activities/ActivityDetailView'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection, type ActivityImageUploadStatus } from '@/components/activities/ActivityImageUploader'
import { ActivityStatusBadge } from '@/components/activities/ActivityCard'
import { ActivityRegistrationFormDesigner, type ActivityQuestionDraft } from '@/components/activities/ActivityRegistrationFormDesigner'
import { ActivityRegistrationManager } from '@/components/activities/ActivityRegistrationManager'
import { activityDisplayStatusLabels, activityTypeLabels, activityTypeValues, getActivityDisplayStatus, type ActivityStatusValue, type ActivityTypeValue, type ActivityVerificationModeValue, type ActivityView } from '@/lib/activity'
import { formatBeijingDateTimeInput } from '@/lib/registration-availability'

type ActivityForm = {
  title: string
  subtitle: string
  description: string
  type: ActivityTypeValue
  coverUrl: string | null
  bannerUrl: string | null
  locationName: string
  locationAddress: string
  onlineUrl: string
  startsAt: string
  endsAt: string
  registrationStartAt: string
  registrationEndAt: string
  verificationMode: ActivityVerificationModeValue
  signupLimit: string
  organizer: string
  contactInfo: string
  isFeatured: boolean
  isPinned: boolean
  sortOrder: string
}

const emptyForm: ActivityForm = {
  title: '', subtitle: '', description: '', type: 'OTHER', coverUrl: null, bannerUrl: null, locationName: '', locationAddress: '', onlineUrl: '',
  startsAt: '', endsAt: '', registrationStartAt: '', registrationEndAt: '', verificationMode: 'NONE', signupLimit: '', organizer: '', contactInfo: '', isFeatured: false, isPinned: false, sortOrder: '0',
}
const emptySelection: ActivityImageSelection = { file: null, removed: false }

function dateInput(value: string | null) {
  return value ? formatBeijingDateTimeInput(new Date(value)) : ''
}

function formFromActivity(activity: ActivityView): ActivityForm {
  return {
    title: activity.title,
    subtitle: activity.subtitle || '',
    description: activity.description,
    type: activity.type,
    coverUrl: activity.coverUrl,
    bannerUrl: activity.bannerUrl,
    locationName: activity.locationName || '',
    locationAddress: activity.locationAddress || '',
    onlineUrl: activity.onlineUrl || '',
    startsAt: dateInput(activity.startsAt),
    endsAt: dateInput(activity.endsAt),
    registrationStartAt: dateInput(activity.registrationStartAt),
    registrationEndAt: dateInput(activity.registrationEndAt),
    verificationMode: activity.verificationMode || 'NONE',
    signupLimit: activity.signupLimit === null ? '' : String(activity.signupLimit),
    organizer: activity.organizer || '',
    contactInfo: activity.contactInfo || '',
    isFeatured: activity.isFeatured,
    isPinned: activity.isPinned,
    sortOrder: String(activity.sortOrder),
  }
}

function statusLabel(status: ActivityStatusValue) {
  return status === 'DRAFT' ? activityDisplayStatusLabels.DRAFT : status === 'CANCELLED' ? activityDisplayStatusLabels.CANCELLED : '已发布'
}

function publishValidationMessage(form: ActivityForm) {
  if (!form.title.trim()) return '请填写活动标题'
  if (!form.type) return '请选择活动类型'
  if (!form.startsAt) return '请选择活动开始时间'
  if (!form.endsAt) return '请选择活动结束时间'
  if (!form.description.trim()) return '请填写活动说明'
  return ''
}

function toPreview(form: ActivityForm, id: string | null, status: ActivityStatusValue): ActivityView {
  const startsAt = form.startsAt ? new Date(`${form.startsAt}:00+08:00`).toISOString() : null
  const endsAt = form.endsAt ? new Date(`${form.endsAt}:00+08:00`).toISOString() : null
  return {
    id: id || 'preview', title: form.title || '未命名活动', subtitle: form.subtitle || null, description: form.description,
    type: form.type, status, displayStatus: getActivityDisplayStatus({ status, startsAt, endsAt }), coverUrl: form.coverUrl, bannerUrl: form.bannerUrl,
    locationName: form.locationName || null, locationAddress: form.locationAddress || null, onlineUrl: form.onlineUrl || null,
    pointsReward: null, signupLimit: form.signupLimit ? Number(form.signupLimit) : null, signupCount: 0, startsAt, endsAt,
    registrationStartAt: form.registrationStartAt ? new Date(`${form.registrationStartAt}:00+08:00`).toISOString() : null,
    registrationEndAt: form.registrationEndAt ? new Date(`${form.registrationEndAt}:00+08:00`).toISOString() : null,
    verificationMode: form.verificationMode,
    organizer: form.organizer || null, contactInfo: form.contactInfo || null, isFeatured: form.isFeatured, isPinned: form.isPinned,
    sortOrder: Number(form.sortOrder) || 0, viewCount: 0, publishedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}

export function ActivityAdminManager({ initialActivities }: Readonly<{ initialActivities: ActivityView[] }>) {
  const [activities, setActivities] = useState(initialActivities)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ActivityForm>(emptyForm)
  const [registrationQuestions, setRegistrationQuestions] = useState<ActivityQuestionDraft[]>([])
  const [rewardBadgeId, setRewardBadgeId] = useState('')
  const [badgeOptions, setBadgeOptions] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [loadingActivityConfig, setLoadingActivityConfig] = useState(false)
  const [coverSelection, setCoverSelection] = useState<ActivityImageSelection>(emptySelection)
  const [bannerSelection, setBannerSelection] = useState<ActivityImageSelection>(emptySelection)
  const [coverStatus, setCoverStatus] = useState<ActivityImageUploadStatus>('idle')
  const [bannerStatus, setBannerStatus] = useState<ActivityImageUploadStatus>('idle')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ kind: 'cancel' | 'delete'; id: string } | null>(null)
  const [registrationActivityId, setRegistrationActivityId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | ActivityStatusValue | 'ENDED'>('ALL')
  const [typeFilter, setTypeFilter] = useState<'ALL' | ActivityTypeValue>('ALL')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void fetch('/api/admin/activities/badges', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (Array.isArray(data?.badges)) setBadgeOptions(data.badges) })
      .catch(() => undefined)
  }, [])

  const editingActivity = editingId ? activities.find((item) => item.id === editingId) || null : null
  const visibleActivities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return activities.filter((activity) => {
      if (statusFilter !== 'ALL' && (statusFilter === 'ENDED' ? getActivityDisplayStatus(activity) !== 'ENDED' : activity.status !== statusFilter)) return false
      if (typeFilter !== 'ALL' && activity.type !== typeFilter) return false
      return !normalizedQuery || `${activity.title}\n${activity.subtitle || ''}\n${activity.description}\n${activity.locationName || ''}\n${activity.organizer || ''}`.toLowerCase().includes(normalizedQuery)
    })
  }, [activities, query, statusFilter, typeFilter])

  function reset() {
    setEditingId(null)
    setForm(emptyForm)
    setRegistrationQuestions([])
    setRewardBadgeId('')
    setCoverSelection(emptySelection)
    setBannerSelection(emptySelection)
    setCoverStatus('idle')
    setBannerStatus('idle')
    setPreviewOpen(false)
  }

  async function edit(activity: ActivityView) {
    setEditingId(activity.id)
    setForm(formFromActivity(activity))
    setRegistrationQuestions([])
    setRewardBadgeId('')
    setCoverSelection(emptySelection)
    setBannerSelection(emptySelection)
    setCoverStatus('idle')
    setBannerStatus('idle')
    setPreviewOpen(false)
    setError('')
    setLoadingActivityConfig(true)
    try {
      const [activityResponse, badgeResponse] = await Promise.all([
        fetch(`/api/admin/activities/${activity.id}`, { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/admin/activities/badges', { credentials: 'same-origin', cache: 'no-store' }),
      ])
      const detail = await activityResponse.json().catch(() => null)
      const badgeData = await badgeResponse.json().catch(() => null)
      if (activityResponse.ok) {
        setRegistrationQuestions(Array.isArray(detail?.registrationQuestions) ? detail.registrationQuestions.map((question: ActivityQuestionDraft) => ({ ...question, placeholder: question.placeholder || '', options: Array.isArray(question.options) ? question.options : [] })) : [])
        setRewardBadgeId(typeof detail?.activityReward?.badgeId === 'string' ? detail.activityReward.badgeId : '')
      }
      if (badgeResponse.ok) setBadgeOptions(Array.isArray(badgeData?.badges) ? badgeData.badges : [])
    } catch {
      setError('活动报名配置加载失败，请稍后重试')
    } finally {
      setLoadingActivityConfig(false)
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function changeForm<K extends keyof ActivityForm>(key: K, value: ActivityForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function handleImageSelection(kind: 'cover' | 'banner', selection: ActivityImageSelection) {
    if (kind === 'cover') setCoverSelection(selection)
    else setBannerSelection(selection)
    setError('')
  }

  async function save(desiredStatus: ActivityStatusValue, event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (savingRef.current) return
    if (desiredStatus === 'PUBLISHED') {
      const validationMessage = publishValidationMessage(form)
      if (validationMessage) {
        setError(validationMessage)
        setMessage('')
        return
      }
    }
    savingRef.current = true
    setSaving(true)
    setMessage('')
    setError('')
    try {
      let coverUrl = form.coverUrl
      let bannerUrl = form.bannerUrl
      if (coverSelection.removed) coverUrl = null
      if (bannerSelection.removed) bannerUrl = null
      if (coverSelection.file) {
        setCoverStatus('uploading')
        coverUrl = await uploadActivityImage(coverSelection.file)
        setCoverStatus('success')
      }
      if (bannerSelection.file) {
        setBannerStatus('uploading')
        bannerUrl = await uploadActivityImage(bannerSelection.file)
        setBannerStatus('success')
      }
      const payload = {
        ...form,
        coverUrl,
        bannerUrl,
        status: desiredStatus,
        signupLimit: form.signupLimit === '' ? null : form.signupLimit,
        sortOrder: form.sortOrder || '0',
        registrationQuestions,
        activityReward: rewardBadgeId ? { badgeId: rewardBadgeId, enabled: true } : null,
      }
      const response = await fetch(editingId ? `/api/admin/activities/${editingId}` : '/api/admin/activities', {
        method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) { setError(data?.message || '保存活动失败'); return }
      const nextActivity = data?.activity as ActivityView
      if (!nextActivity) { setError('保存结果无效，请刷新后重试'); return }
      setActivities((current) => editingId ? current.map((item) => item.id === editingId ? nextActivity : item) : [nextActivity, ...current])
      setMessage(desiredStatus === 'PUBLISHED' ? '活动已保存并发布' : editingId ? '活动已保存' : '草稿已保存')
      reset()
    } catch (saveError) {
      if (coverSelection.file) setCoverStatus('error')
      if (bannerSelection.file) setBannerStatus('error')
      setError(saveError instanceof Error ? saveError.message : '保存活动失败，请稍后重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function updateStatus(id: string, status: ActivityStatusValue) {
    if (actionLoading || saving) return
    setActionLoading(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ status }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) { setError(data?.message || '更新活动状态失败'); return }
      setActivities((current) => current.map((item) => item.id === id ? data.activity as ActivityView : item))
      setMessage(status === 'PUBLISHED' ? '活动已发布' : status === 'DRAFT' ? '活动已撤下并保存为草稿' : '活动已取消')
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : '更新活动状态失败')
    } finally {
      setActionLoading(false)
    }
  }

  async function deleteActivity(id: string) {
    if (actionLoading || saving) return
    setActionLoading(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      const data = await response.json().catch(() => null)
      if (!response.ok) { setError(data?.message || '删除活动失败'); return }
      setActivities((current) => current.filter((item) => item.id !== id))
      if (editingId === id) reset()
      setMessage('草稿已删除')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除活动失败')
    } finally {
      setActionLoading(false)
      setConfirmAction(null)
    }
  }

  async function confirmActionNow() {
    if (!confirmAction) return
    if (confirmAction.kind === 'delete') await deleteActivity(confirmAction.id)
    else {
      await updateStatus(confirmAction.id, 'CANCELLED')
      setConfirmAction(null)
    }
  }

  const preview = toPreview(form, editingId, editingActivity?.status || 'DRAFT')

  return (
    <>
      <form noValidate onSubmit={(event) => void save(editingActivity?.status || 'DRAFT', event)} className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-black tracking-[0.18em] text-sky-700 dark:text-sky-300">{editingId ? '编辑活动' : '新建活动'}</p><h2 className="mt-1 text-2xl font-black text-brand-950 dark:text-slate-100">{editingId ? editingActivity?.title || '活动编辑' : '创建活动草稿'}</h2></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPreviewOpen((value) => !value)} disabled={saving} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50 dark:bg-slate-800 dark:text-sky-200">{previewOpen ? '收起预览' : '预览活动'}</button>
            {editingId ? <button type="button" onClick={reset} disabled={saving} className="rounded-full border border-sky-100 px-4 py-2 text-sm font-black text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">取消编辑</button> : null}
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">标题<input aria-required="true" maxLength={160} value={form.title} onChange={(event) => changeForm('title', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 outline-none focus:border-sky-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">副标题<input maxLength={300} value={form.subtitle} onChange={(event) => changeForm('subtitle', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 outline-none focus:border-sky-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">活动类型<select aria-required="true" value={form.type} onChange={(event) => changeForm('type', event.target.value as ActivityTypeValue)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">{activityTypeValues.map((item) => <option key={item} value={item}>{activityTypeLabels[item]}</option>)}</select></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">开始时间<input aria-required="true" type="datetime-local" value={form.startsAt} onChange={(event) => changeForm('startsAt', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">结束时间<input aria-required="true" type="datetime-local" value={form.endsAt} onChange={(event) => changeForm('endsAt', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        </div>
        <label className="mt-4 block text-sm font-black text-slate-700 dark:text-slate-200">活动说明<textarea aria-required="true" rows={7} maxLength={20000} value={form.description} onChange={(event) => changeForm('description', event.target.value)} className="mt-1 w-full rounded-xl border border-sky-100 bg-white px-3 py-3 font-bold leading-6 text-slate-800 outline-none focus:border-sky-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ActivityImageUploader label="卡片封面" initialUrl={form.coverUrl} disabled={saving} status={coverStatus} onSelectionChange={(selection) => handleImageSelection('cover', selection)} />
          <ActivityImageUploader label="详情横幅（可选）" initialUrl={form.bannerUrl} disabled={saving} status={bannerStatus} onSelectionChange={(selection) => handleImageSelection('banner', selection)} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">活动地点<input value={form.locationName} onChange={(event) => changeForm('locationName', event.target.value)} placeholder="可选" className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">详细地址<input value={form.locationAddress} onChange={(event) => changeForm('locationAddress', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">线上活动链接<input type="url" value={form.onlineUrl} onChange={(event) => changeForm('onlineUrl', event.target.value)} placeholder="可选，仅作为活动资料" className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">报名名额<input type="number" min="0" value={form.signupLimit} onChange={(event) => changeForm('signupLimit', event.target.value)} placeholder="留空表示不限" className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">报名开始时间<input type="datetime-local" value={form.registrationStartAt} onChange={(event) => changeForm('registrationStartAt', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">报名结束时间<input type="datetime-local" value={form.registrationEndAt} onChange={(event) => changeForm('registrationEndAt', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">主办方<input value={form.organizer} onChange={(event) => changeForm('organizer', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">联系方式<input value={form.contactInfo} onChange={(event) => changeForm('contactInfo', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">现场核销方式<select value={form.verificationMode} onChange={(event) => { const mode = event.target.value as ActivityVerificationModeValue; changeForm('verificationMode', mode); if (mode === 'NONE') setRewardBadgeId('') }} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="NONE">不启用核销</option><option value="MANUAL">管理员手动核销</option><option value="QR">扫码核销</option></select></label>
          <label className="text-sm font-black text-slate-700 dark:text-slate-200">核销后隐藏奖励（可选）<select value={rewardBadgeId} onChange={(event) => setRewardBadgeId(event.target.value)} disabled={loadingActivityConfig || form.verificationMode === 'NONE'} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="">不设置活动勋章</option>{badgeOptions.map((badge) => <option key={badge.id} value={badge.id}>{badge.name} · {badge.code}</option>)}</select></label>
        </div>
        <div className="mt-4"><ActivityRegistrationFormDesigner questions={registrationQuestions} onChange={setRegistrationQuestions} /></div>
        <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl bg-sky-50/70 p-3 dark:bg-slate-800/70">
          <label className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.isFeatured} onChange={(event) => changeForm('isFeatured', event.target.checked)} />精选</label>
          <label className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.isPinned} onChange={(event) => changeForm('isPinned', event.target.checked)} />置顶</label>
          <label className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">排序值<input type="number" value={form.sortOrder} onChange={(event) => changeForm('sortOrder', event.target.value)} className="min-h-9 w-24 rounded-lg border border-sky-100 bg-white px-2 dark:border-slate-600 dark:bg-slate-950" /></label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className="min-h-11 rounded-full bg-brand-950 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{saving ? '保存中…' : editingId ? '保存修改' : '保存草稿'}</button>
          <button type="button" onClick={() => void save('PUBLISHED')} disabled={saving} className="min-h-11 rounded-full bg-emerald-600 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{editingId ? '保存并发布' : '保存并发布活动'}</button>
        </div>
      </form>

      {previewOpen ? <section className="rounded-[28px] border border-sky-100 bg-sky-50/60 p-4 dark:border-slate-700 dark:bg-slate-950/60 sm:p-6"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950 dark:text-slate-100">活动预览</h2><span className="text-xs font-bold text-slate-500">预览不会改变线上状态</span></div><ActivityDetailView activity={preview} preview /></section> : null}
      {message ? <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p> : null}
      {error ? <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p> : null}

      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black tracking-[0.18em] text-sky-700 dark:text-sky-300">活动列表</p><h2 className="mt-1 text-2xl font-black text-brand-950 dark:text-slate-100">全部活动</h2></div><span className="text-sm font-black text-slate-500">共 {visibleActivities.length} 条</span></div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_11rem]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索活动" className="min-h-11 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | ActivityStatusValue | 'ENDED')} className="min-h-11 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="ALL">全部状态</option><option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option><option value="ENDED">已结束</option><option value="CANCELLED">已取消</option></select><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'ALL' | ActivityTypeValue)} className="min-h-11 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="ALL">全部类型</option>{activityTypeValues.map((item) => <option key={item} value={item}>{activityTypeLabels[item]}</option>)}</select></div>
        <div className="mt-5 divide-y divide-sky-100 dark:divide-slate-700">
          {visibleActivities.map((activity) => <article key={activity.id} className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><ActivityStatusBadge activity={activity} /><span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700 dark:bg-slate-800 dark:text-sky-200">{statusLabel(activity.status)}</span><span className="text-xs font-bold text-slate-400">{activityTypeLabels[activity.type]}</span></div><h3 className="mt-3 break-words text-xl font-black text-brand-950 dark:text-slate-100">{activity.title || '未命名活动'}</h3>{activity.subtitle ? <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{activity.subtitle}</p> : null}<p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{activity.description || '暂无说明'}</p><p className="mt-2 text-xs font-bold text-slate-400">浏览 {activity.viewCount} 次{activity.startsAt ? ` · ${dateInput(activity.startsAt).replace('T', ' ')}` : ''}</p></div><div className="flex flex-wrap items-start gap-2 md:flex-col"><button type="button" onClick={() => void edit(activity)} disabled={saving || actionLoading} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50 dark:bg-slate-800 dark:text-sky-200">编辑</button><button type="button" onClick={() => setRegistrationActivityId(registrationActivityId === activity.id ? null : activity.id)} disabled={saving || actionLoading} className="rounded-full border border-emerald-700 px-4 py-2 text-sm font-black text-emerald-700 disabled:opacity-50 dark:text-emerald-300">报名管理</button>{activity.status !== 'DRAFT' ? <Link href={`/activities/${activity.id}`} target="_blank" className="rounded-full border border-sky-100 px-4 py-2 text-center text-sm font-black text-slate-600 dark:border-slate-600 dark:text-slate-300">查看前台</Link> : null}{activity.status === 'DRAFT' ? <button type="button" onClick={() => void updateStatus(activity.id, 'PUBLISHED')} disabled={saving || actionLoading} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">发布</button> : null}{activity.status === 'PUBLISHED' ? <button type="button" onClick={() => void updateStatus(activity.id, 'DRAFT')} disabled={saving || actionLoading} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50 dark:bg-slate-800 dark:text-sky-200">撤下</button> : null}{activity.status !== 'CANCELLED' ? <button type="button" onClick={() => setConfirmAction({ kind: 'cancel', id: activity.id })} disabled={saving || actionLoading} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-50 dark:bg-red-950/40 dark:text-red-200">取消活动</button> : null}{activity.status === 'DRAFT' ? <button type="button" onClick={() => setConfirmAction({ kind: 'delete', id: activity.id })} disabled={saving || actionLoading} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-50 dark:bg-red-950/40 dark:text-red-200">删除</button> : null}</div></article>)}
          {!visibleActivities.length ? <p className="py-8 text-center text-sm font-bold text-slate-500">暂无符合条件的活动。</p> : null}
        </div>
      </section>
      {registrationActivityId ? <ActivityRegistrationManager activityId={registrationActivityId} activityTitle={activities.find((activity) => activity.id === registrationActivityId)?.title || '活动报名'} verificationMode={activities.find((activity) => activity.id === registrationActivityId)?.verificationMode || 'NONE'} onClose={() => setRegistrationActivityId(null)} /> : null}
      <ConfirmDialog open={Boolean(confirmAction)} title={confirmAction?.kind === 'delete' ? '删除活动？' : '取消活动？'} description={confirmAction?.kind === 'delete' ? '删除后将无法恢复。只有没有发布、报名或其他关联数据的草稿可以删除。' : '取消后活动仍会保留并显示“已取消”，不会删除历史数据。'} confirmLabel={confirmAction?.kind === 'delete' ? '确认删除' : '确认取消'} loading={actionLoading} onConfirm={() => void confirmActionNow()} onCancel={() => { if (!actionLoading) setConfirmAction(null) }} />
    </>
  )
}
