'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { publicImageUrl } from '@/lib/images'

type InitialProfile = {
  nickname: string
  avatarUrl: string
  backgroundUrl: string
  bio: string
  email: string
  phone: string
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
}

type UploadKind = 'avatar' | 'background'

export function ProfileSettingsForm({ initialProfile }: { initialProfile: InitialProfile }) {
  const [form, setForm] = useState(initialProfile)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState<UploadKind | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)

  async function uploadImage(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setMessage('')
    setError('')
    setUploading(kind)

    const body = new FormData()
    body.append('file', file)
    body.append('kind', kind)

    const response = await fetch('/api/uploads/profile-image', { method: 'POST', body })
    const data = await response.json().catch(() => null)
    setUploading(null)

    if (!response.ok) {
      setError(data?.message || '图片上传失败，请换一张图片再试')
      event.target.value = ''
      return
    }

    setForm((current) => ({
      ...current,
      [kind === 'avatar' ? 'avatarUrl' : 'backgroundUrl']: data.url,
    }))
    setMessage(kind === 'avatar' ? '头像已上传，点击保存资料后生效' : '背景图已上传，点击保存资料后生效')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')
    setError('')

    const response = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await response.json().catch(() => null)

    setIsSaving(false)
    if (!response.ok) {
      setError(data?.message || '保存失败，请稍后再试')
      return
    }

    if (data?.profile) {
      setForm((current) => ({
        ...current,
        email: data.profile.email || '',
        phone: data.profile.phone || '',
        emailVerifiedAt: data.profile.emailVerifiedAt || null,
        phoneVerifiedAt: data.profile.phoneVerifiedAt || null,
      }))
    }
    setMessage(data?.emailVerificationSent ? '资料已保存，新邮箱需要查收邮件完成验证' : data?.nicknameMessage || '资料已保存')
  }

  function update(key: keyof InitialProfile, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const avatarPreview = publicImageUrl(form.avatarUrl)
  const backgroundPreview = publicImageUrl(form.backgroundUrl)

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-700">Account Settings</p>
        <h2 className="mt-2 text-2xl font-black text-brand-950">账号设置</h2>
        <p className="mt-2 text-sm font-bold text-slate-500">手机号和邮箱仅自己可见；邮箱变更后需要重新验证。</p>
      </div>

      {!form.emailVerifiedAt ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-black leading-6 text-amber-800">
          建议绑定并验证邮箱，提高账户安全性。未验证手机号不能用于找回密码或高风险操作验证。
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-black text-slate-700">昵称</span>
        <input
          value={form.nickname}
          onChange={(event) => update('nickname', event.target.value)}
          minLength={2}
          maxLength={32}
          className="mt-2 w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm font-bold outline-none transition focus:border-brand-700"
          placeholder="请输入昵称"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
          <span className="text-sm font-black text-slate-700">邮箱</span>
          <input
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            type="email"
            className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-4 py-3 text-sm font-bold outline-none"
            placeholder="用于邮箱登录和找回账号"
          />
          <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black ${form.emailVerifiedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {form.emailVerifiedAt ? '已验证' : '未验证'}
          </span>
        </label>

        <label className="block rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
          <span className="text-sm font-black text-slate-700">手机号</span>
          <input
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            type="tel"
            className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-4 py-3 text-sm font-bold outline-none"
            placeholder="选填，绑定后可用于手机号登录"
          />
          <span className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
            {form.phoneVerifiedAt ? '已验证' : '未验证，仅作为已绑定登录标识'}
          </span>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
          <p className="text-sm font-black text-slate-700">头像</p>
          <div className="mt-3 flex items-center gap-4">
            <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-brand-950 text-2xl font-black text-white">
              {avatarPreview ? <img src={avatarPreview} alt="头像预览" className="h-full w-full object-cover" /> : form.nickname.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <button type="button" onClick={() => avatarInputRef.current?.click()} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-brand-950 shadow-sm">
                {uploading === 'avatar' ? '上传中...' : '上传头像'}
              </button>
              <p className="mt-2 text-xs font-bold text-slate-500">支持 JPG、PNG、WEBP、GIF，最大 5MB。</p>
              <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => uploadImage('avatar', event)} className="hidden" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
          <p className="text-sm font-black text-slate-700">主页背景图</p>
          <div className="mt-3 overflow-hidden rounded-2xl bg-white">
            <div
              className="grid aspect-[16/7] place-items-center bg-gradient-to-r from-sky-100 via-white to-cyan-50 text-sm font-black text-slate-400"
              style={backgroundPreview ? { backgroundImage: `url(${backgroundPreview})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              {backgroundPreview ? '' : '背景预览'}
            </div>
          </div>
          <button type="button" onClick={() => backgroundInputRef.current?.click()} className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-black text-brand-950 shadow-sm">
            {uploading === 'background' ? '上传中...' : '上传背景图'}
          </button>
          <input ref={backgroundInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => uploadImage('background', event)} className="hidden" />
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-black text-slate-700">个人简介</span>
        <textarea
          value={form.bio}
          onChange={(event) => update('bio', event.target.value)}
          rows={5}
          maxLength={300}
          className="mt-2 w-full resize-none rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm font-bold leading-7 outline-none transition focus:border-brand-700"
          placeholder="写一点关于你的 Eason 故事"
        />
      </label>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}

      <button disabled={isSaving || uploading !== null} className="w-full rounded-2xl bg-brand-950 px-5 py-3 text-sm font-black text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60">
        {isSaving ? '保存中...' : '保存资料'}
      </button>
    </form>
  )
}
