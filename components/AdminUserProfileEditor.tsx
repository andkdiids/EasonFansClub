'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { InternationalPhoneInput } from '@/components/InternationalPhoneInput'
import { UserLocationPicker } from '@/components/UserLocationPicker'
import { getPhoneInputParts, normalizePhoneNumber, type PhoneCountryCode } from '@/lib/phone-number'
import { validateLoginAccountValue, validateNicknameValue } from '@/lib/login-account'
import type { UserLocation } from '@/lib/user-location'
import { daysForBirthdayMonth, resetInvalidBirthdayDay } from '@/lib/birthday-profile-flow'
import { isValidBirthdayParts } from '@/lib/zodiac'
import { CUSTOM_GENDER_MAX_LENGTH, validateGenderInput, type GenderValue } from '@/lib/gender'

export type AdminUserProfileInitial = {
  username: string
  nickname: string
  email: string
  phone: string
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  bio: string
  gender: GenderValue | null
  customGender: string
  avatarUrl: string
  backgroundUrl: string
  location: UserLocation | null
  wallVisibility: 'PUBLIC' | 'FRIENDS' | 'CLOSED'
  birthMonth: number | null
  birthDay: number | null
  birthdateSelfEditCount: number
  birthdayPublic: boolean
  showBadgeActivity: boolean
  showBadgeProgressNotifications: boolean
}

type ProfileForm = AdminUserProfileInitial

function birthdayText(month: number | null, day: number | null) {
  return month != null && day != null ? `${month}月${day}日` : '未设置'
}

export function AdminUserProfileEditor({ targetUserId, initialProfile }: { targetUserId: string; initialProfile: AdminUserProfileInitial }) {
  const router = useRouter()
  const [saved, setSaved] = useState<ProfileForm>(initialProfile)
  const [form, setForm] = useState<ProfileForm>(initialProfile)
  const initialPhoneParts = getPhoneInputParts(initialProfile.phone)
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountryCode>(initialPhoneParts.country)
  const [phoneValue, setPhoneValue] = useState(initialPhoneParts.value)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmPayload, setConfirmPayload] = useState<Record<string, unknown> | null>(null)
  const [confirmDescription, setConfirmDescription] = useState('')
  const [confirmError, setConfirmError] = useState('')

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
    setMessage('')
  }

  function updateBirthdayMonth(month: number | null) {
    setForm((current) => ({
      ...current,
      birthMonth: month,
      birthDay: resetInvalidBirthdayDay(month, current.birthDay),
    }))
    setError('')
    setMessage('')
  }

  function validateForm() {
    const username = validateLoginAccountValue(form.username)
    if (username.error) return username.error
    const nickname = validateNicknameValue(form.nickname)
    if (nickname.error) return nickname.error
    const gender = validateGenderInput(form.gender, form.customGender)
    if (gender.error) return gender.error
    const rawPhone = phoneValue.trim()
    if (rawPhone && !normalizePhoneNumber(rawPhone, phoneCountry)) return '手机号格式不正确'
    if ((form.birthMonth == null) !== (form.birthDay == null)) return '生日必须完整填写月份和日期'
    if (form.birthMonth != null && form.birthDay != null && !isValidBirthdayParts({ month: form.birthMonth, day: form.birthDay })) {
      return '该日期不存在，请重新选择'
    }
    return ''
  }

  function makePayload() {
    const normalizedPhone = phoneValue.trim() ? normalizePhoneNumber(phoneValue.trim(), phoneCountry) : null
    const birthdayChanged = form.birthMonth !== saved.birthMonth || form.birthDay !== saved.birthDay
    const payload: Record<string, unknown> = {
      action: 'updateProfile',
      username: form.username,
      nickname: form.nickname,
      email: form.email.trim(),
      phone: normalizedPhone?.e164 || '',
      phoneCountry: normalizedPhone?.country || phoneCountry,
      bio: form.bio,
      gender: form.gender,
      customGender: form.gender === 'CUSTOM' ? form.customGender : '',
      avatarUrl: form.avatarUrl,
      backgroundUrl: form.backgroundUrl,
      location: form.location,
      wallVisibility: form.wallVisibility,
      birthdayPublic: form.birthdayPublic,
      showBadgeActivity: form.showBadgeActivity,
      showBadgeProgressNotifications: form.showBadgeProgressNotifications,
    }
    if (birthdayChanged) {
      payload.birthMonth = form.birthMonth ?? ''
      payload.birthDay = form.birthDay ?? ''
    }
    return { payload, birthdayChanged, normalizedPhone }
  }

  async function submitProfile(payload: Record<string, unknown>) {
    if (isSaving) return
    setIsSaving(true)
    setError('')
    setConfirmError('')
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const nextError = data?.message || '用户资料保存失败'
        setError(nextError)
        setConfirmError(nextError)
        return
      }

      const nextPhone = typeof data?.user?.phone === 'string' ? data.user.phone : (payload.phone as string || '')
      const nextPhoneParts = getPhoneInputParts(nextPhone, phoneCountry)
      const next: ProfileForm = {
        ...form,
        username: typeof data?.user?.username === 'string' ? data.user.username : form.username,
        nickname: typeof data?.user?.nickname === 'string' ? data.user.nickname : form.nickname,
        email: typeof data?.user?.email === 'string' ? data.user.email : '',
        phone: nextPhone,
        emailVerifiedAt: typeof data?.user?.emailVerifiedAt === 'string' ? data.user.emailVerifiedAt : null,
        phoneVerifiedAt: typeof data?.user?.phoneVerifiedAt === 'string' ? data.user.phoneVerifiedAt : null,
        bio: typeof data?.user?.bio === 'string' ? data.user.bio : data?.user?.bio == null ? '' : form.bio,
        gender: data?.user?.gender === 'MALE' || data?.user?.gender === 'FEMALE' || data?.user?.gender === 'CUSTOM' || data?.user?.gender === 'PRIVATE' ? data.user.gender : null,
        customGender: typeof data?.user?.customGender === 'string' ? data.user.customGender : '',
        avatarUrl: typeof data?.user?.avatarUrl === 'string' ? data.user.avatarUrl : data?.user?.avatarUrl == null ? '' : form.avatarUrl,
        backgroundUrl: typeof data?.user?.backgroundUrl === 'string' ? data.user.backgroundUrl : data?.user?.backgroundUrl == null ? '' : form.backgroundUrl,
        birthMonth: typeof data?.user?.birthMonth === 'number' ? data.user.birthMonth : null,
        birthDay: typeof data?.user?.birthDay === 'number' ? data.user.birthDay : null,
        birthdateSelfEditCount: typeof data?.user?.birthdateSelfEditCount === 'number' ? data.user.birthdateSelfEditCount : form.birthdateSelfEditCount,
        birthdayPublic: typeof data?.user?.birthdayPublic === 'boolean' ? data.user.birthdayPublic : form.birthdayPublic,
        showBadgeActivity: typeof data?.user?.showBadgeActivity === 'boolean' ? data.user.showBadgeActivity : form.showBadgeActivity,
        showBadgeProgressNotifications: typeof data?.user?.showBadgeProgressNotifications === 'boolean' ? data.user.showBadgeProgressNotifications : form.showBadgeProgressNotifications,
        location: form.location,
        wallVisibility: form.wallVisibility,
      }
      setSaved(next)
      setForm(next)
      setPhoneCountry(nextPhoneParts.country)
      setPhoneValue(nextPhoneParts.value)
      setConfirmPayload(null)
      setMessage(data?.message || '用户资料已更新')
      if (Array.isArray(data?.equippedBadges) && typeof CustomEvent === 'function' && typeof data?.user?.uid === 'number') {
        const equippedBadges = data.equippedBadges
        window.dispatchEvent(new CustomEvent('eason-badge-updated', {
          detail: { uid: data.user.uid, equippedBadges, equippedBadge: equippedBadges[0] || null },
        }))
        window.dispatchEvent(new CustomEvent('eason-badge-collection-updated', { detail: { uid: data.user.uid } }))
      }
      router.refresh()
    } catch (saveError) {
      const nextError = saveError instanceof Error ? saveError.message : '用户资料保存失败'
      setError(nextError)
      setConfirmError(nextError)
    } finally {
      setIsSaving(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    const { payload, birthdayChanged, normalizedPhone } = makePayload()
    const changedLabels: string[] = []
    if (form.username !== saved.username) changedLabels.push('用户名')
    if (form.nickname !== saved.nickname) changedLabels.push('昵称')
    if (form.email.trim() !== saved.email) changedLabels.push('邮箱')
    if ((normalizedPhone?.e164 || '') !== saved.phone) changedLabels.push('手机号')
    if (birthdayChanged) changedLabels.push('生日')
    const highImpact = changedLabels.some((label) => ['用户名', '邮箱', '手机号', '生日'].includes(label))
    if (highImpact) {
      const details = changedLabels.length ? `将修改：${changedLabels.join('、')}。` : '将保存当前资料。'
      setConfirmDescription(`${details}${birthdayChanged ? '\n生日变更后，生日及星座勋章将根据新生日重新计算。' : ''}`)
      setConfirmPayload(payload)
      setConfirmError('')
      return
    }
    void submitProfile(payload)
  }

  const hasBirthday = saved.birthMonth != null && saved.birthDay != null
  const birthdayCount = Math.max(0, saved.birthdateSelfEditCount)

  return (
    <>
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-sky-700">用户资料编辑</p>
          <h2 className="mt-2 text-2xl font-black text-brand-950">编辑用户资料</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500">仅开放普通资料字段；角色、密码、积分、经验、徽章归属和安全令牌仍由各自的专用流程管理。</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-black text-slate-700">
              用户名（登录账号）
              <input value={form.username} onChange={(event) => update('username', event.target.value)} minLength={2} maxLength={16} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 px-3 font-bold outline-none focus:border-brand-400" />
              <span className="mt-1 block text-xs font-bold text-slate-400">沿用现有长度、字符、保留词和唯一性规则。</span>
            </label>
            <label className="block text-sm font-black text-slate-700">
              昵称
              <input value={form.nickname} onChange={(event) => update('nickname', event.target.value)} minLength={2} maxLength={16} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 px-3 font-bold outline-none focus:border-brand-400" />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-black text-slate-700">
              邮箱
              <input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 px-3 font-bold outline-none focus:border-brand-400" placeholder="可留空清除" />
              <span className="mt-1 block text-xs font-bold text-slate-400">管理员修改后沿用现有规则，不会自动标记为已验证。</span>
            </label>
            <label className="block text-sm font-black text-slate-700">
              手机号
              <InternationalPhoneInput value={phoneValue} country={phoneCountry} onChange={(value) => { setPhoneValue(value); setError(''); setMessage('') }} onCountryChange={setPhoneCountry} disabled={isSaving} placeholder="可留空清除" containerClassName="mt-2" inputClassName="font-bold" />
              <span className="mt-1 block text-xs font-bold text-slate-400">号码发生变化后会清除原有验证状态。</span>
            </label>
          </div>

          <fieldset className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
            <legend className="px-1 text-sm font-black text-slate-700">性别</legend>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="性别">
              {([
                ['MALE', '男'],
                ['FEMALE', '女'],
                ['CUSTOM', '自定义'],
                ['PRIVATE', '保密'],
              ] as const satisfies ReadonlyArray<readonly [GenderValue, string]>).map(([value, label]) => (
                <label key={value} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-black text-brand-800">
                  <input
                    type="radio"
                    name="admin-profile-gender"
                    value={value}
                    checked={form.gender === value}
                    onChange={() => update('gender', value)}
                    className="h-4 w-4 accent-sky-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            {form.gender === 'CUSTOM' ? (
              <label className="mt-3 block text-sm font-black text-slate-700">
                自定义内容
                <input
                  value={form.customGender}
                  onChange={(event) => update('customGender', event.target.value.replace(/[\r\n]+/gu, ' '))}
                  maxLength={CUSTOM_GENDER_MAX_LENGTH}
                  className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold outline-none focus:border-brand-400"
                  placeholder="例如：非二元、流动"
                />
                <span className="mt-1 block text-xs font-bold text-slate-400">限 20 个字符，不可换行或使用 HTML 标记。</span>
              </label>
            ) : null}
          </fieldset>

          <label className="block text-sm font-black text-slate-700">
            个人简介
            <textarea value={form.bio} onChange={(event) => update('bio', event.target.value)} maxLength={300} rows={4} className="mt-2 w-full resize-y rounded-xl border border-sky-100 px-3 py-2 font-bold leading-6 outline-none focus:border-brand-400" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-black text-slate-700">
              头像地址
              <input value={form.avatarUrl} onChange={(event) => update('avatarUrl', event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 px-3 font-bold outline-none focus:border-brand-400" placeholder="留空清除" />
            </label>
            <label className="block text-sm font-black text-slate-700">
              个人背景图地址
              <input value={form.backgroundUrl} onChange={(event) => update('backgroundUrl', event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 px-3 font-bold outline-none focus:border-brand-400" placeholder="留空清除" />
            </label>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
            <p className="text-sm font-black text-slate-700">地区</p>
            <UserLocationPicker value={form.location} onChange={(value) => update('location', value)} />
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-700">生日</p>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-500">当前：{birthdayText(saved.birthMonth, saved.birthDay)} · 本人修改次数 {birthdayCount}/1。管理员修改不会消耗或恢复本人修改机会。</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-brand-700">{hasBirthday ? '已设置' : '未设置'}</span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-black text-slate-700">
                月份
                <select value={form.birthMonth ?? ''} onChange={(event) => updateBirthdayMonth(event.target.value ? Number(event.target.value) : null)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold outline-none focus:border-brand-400">
                  <option value="">未设置</option>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}月</option>)}
                </select>
              </label>
              <label className="block text-sm font-black text-slate-700">
                日期
                <select value={form.birthDay ?? ''} onChange={(event) => update('birthDay', event.target.value ? Number(event.target.value) : null)} className="mt-2 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold outline-none focus:border-brand-400">
                  <option value="">未设置</option>
                  {Array.from({ length: daysForBirthdayMonth(form.birthMonth) }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}日</option>)}
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs font-bold leading-5 text-slate-500">生日只能保存完整且合法的月/日；2 月 29 日受支持。管理员可修正生日，但不会改变本人修改次数。</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4 text-sm font-black text-slate-700">
              生日公开
              <input type="checkbox" checked={form.birthdayPublic} onChange={(event) => update('birthdayPublic', event.target.checked)} className="size-5 accent-sky-600" />
            </label>
            <label className="block rounded-2xl border border-sky-100 bg-sky-50/50 p-4 text-sm font-black text-slate-700">
              留言墙可见范围
              <select value={form.wallVisibility} onChange={(event) => update('wallVisibility', event.target.value as ProfileForm['wallVisibility'])} className="mt-2 min-h-10 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold outline-none">
                <option value="PUBLIC">公开</option>
                <option value="FRIENDS">仅好友</option>
                <option value="CLOSED">关闭</option>
              </select>
            </label>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4 text-sm font-black text-slate-700">
            勋章获得动态
            <input type="checkbox" checked={form.showBadgeActivity} onChange={(event) => update('showBadgeActivity', event.target.checked)} className="size-5 accent-sky-600" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4 text-sm font-black text-slate-700">
            勋章进度提醒
            <input type="checkbox" checked={form.showBadgeProgressNotifications} onChange={(event) => update('showBadgeProgressNotifications', event.target.checked)} className="size-5 accent-sky-600" />
          </label>

          {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
          {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}
          <div className="flex justify-end">
            <button type="submit" disabled={isSaving} className="min-h-11 rounded-full bg-brand-950 px-6 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? '保存中…' : '保存用户资料'}</button>
          </div>
        </form>
      </section>

      <ConfirmDialog
        open={Boolean(confirmPayload)}
        title="确认修改该用户资料？"
        description={confirmDescription}
        confirmLabel="确认修改"
        cancelLabel="取消"
        loading={isSaving}
        error={confirmError}
        onConfirm={() => { if (confirmPayload) void submitProfile(confirmPayload) }}
        onCancel={() => { if (!isSaving) { setConfirmPayload(null); setConfirmError('') } }}
      />
    </>
  )
}
