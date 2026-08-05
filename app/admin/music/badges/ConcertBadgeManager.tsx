'use client'

import { useRef, useState } from 'react'

type TourOption = { id: string; name: string }
type BadgeRow = {
  id: string
  name: string
  slug: string
  description: string | null
  iconUrl: string | null
  isActive: boolean
  category: 'SYSTEM' | 'BIRTHDAY' | 'CONCERT'
  musicTourId: string | null
  musicTour: { id: string; name: string } | null
}

const CATEGORY_LABEL: Record<BadgeRow['category'], string> = {
  SYSTEM: '系统',
  BIRTHDAY: '生日',
  CONCERT: '演唱会',
}

type FormState = {
  name: string
  description: string
  musicTourId: string
  iconUrl: string | null
  isActive: boolean
}

const EMPTY_FORM: FormState = { name: '', description: '', musicTourId: '', iconUrl: null, isActive: true }

export function ConcertBadgeManager({ initialBadges, tours }: { initialBadges: BadgeRow[]; tours: TourOption[] }) {
  const [badges, setBadges] = useState<BadgeRow[]>(initialBadges)
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function applyUpdate(updated: BadgeRow) {
    setBadges((current) => {
      const idx = current.findIndex((b) => b.id === updated.id)
      if (idx === -1) return [updated, ...current]
      const next = current.slice()
      next[idx] = updated
      return next
    })
  }

  function applyDelete(id: string) {
    setBadges((current) => current.filter((b) => b.id !== id))
  }

  async function uploadIcon(file: File, onUrl: (url: string) => void) {
    const fd = new FormData()
    fd.set('file', file)
    setMessage(null)
    const res = await fetch('/api/admin/music/badges/icon', { method: 'POST', body: fd })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.success) {
      setMessage(data?.message || '图标上传失败')
      return
    }
    onUrl(data.url as string)
  }

  async function createBadge(form: FormState) {
    setMessage(null)
    const res = await fetch('/api/admin/music/badges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.badge) {
      setMessage(data?.message || '创建失败')
      return
    }
    setBadges((current) => [data.badge as BadgeRow, ...current])
    setCreating(false)
    setMessage('已创建演唱会纪念徽章')
  }

  async function patchBadge(id: string, patch: Record<string, unknown>) {
    setMessage(null)
    const res = await fetch(`/api/admin/music/badges/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.badge) {
      setMessage(data?.message || '更新失败')
      return
    }
    applyUpdate(data.badge as BadgeRow)
  }

  async function toggleActive(badge: BadgeRow) {
    await patchBadge(badge.id, { isActive: !badge.isActive })
  }

  async function removeBadge(badge: BadgeRow) {
    if (!window.confirm(`确定删除徽章「${badge.name}」吗？已授予用户的记录也会一并清除。`)) return
    setMessage(null)
    const res = await fetch(`/api/admin/music/badges/${badge.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setMessage(data?.message || '删除失败')
      return
    }
    applyDelete(badge.id)
    setMessage('已删除徽章')
  }

  return (
    <section className="space-y-6">
      {message ? (
        <p className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-brand-700">{message}</p>
      ) : null}

      <div className="rounded-[26px] border border-sky-100 bg-white/88 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-brand-950">徽章列表</h2>
          {!creating ? (
            <button
              type="button"
              onClick={() => {
                setCreating(true)
                setEditId(null)
                setMessage(null)
              }}
              className="rounded-full bg-brand-700 px-5 py-2 text-sm font-black text-white"
            >
              + 新建徽章
            </button>
          ) : null}
        </div>

        {creating ? (
          <BadgeForm
            tours={tours}
            initial={EMPTY_FORM}
            submitLabel="创建徽章"
            onUploadIcon={uploadIcon}
            onCancel={() => setCreating(false)}
            onSubmit={createBadge}
          />
        ) : null}

        {badges.length === 0 ? (
          <p className="mt-5 text-sm font-bold text-slate-500">还没有徽章，点击右上角「新建徽章」开始创建。</p>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {badges.map((badge) =>
              editId === badge.id ? (
                <BadgeForm
                  key={badge.id}
                  tours={tours}
                  initial={{
                    name: badge.name,
                    description: badge.description || '',
                    musicTourId: badge.musicTourId || '',
                    iconUrl: badge.iconUrl,
                    isActive: badge.isActive,
                  }}
                  submitLabel="保存修改"
                  onUploadIcon={uploadIcon}
                  onCancel={() => setEditId(null)}
                  onSubmit={(form) => patchBadge(badge.id, form).then(() => setEditId(null))}
                />
              ) : (
                <div key={badge.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    {badge.iconUrl ? (
                      <img src={badge.iconUrl} alt={badge.name} className="h-12 w-12 rounded-xl object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-2xl">🏅</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-brand-950">{badge.name}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">{badge.description || '暂无介绍'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{CATEGORY_LABEL[badge.category]}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                      {badge.musicTour?.name || '未关联巡演'}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 ${badge.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {badge.isActive ? '已启用' : '已停用'}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(badge.id)
                        setCreating(false)
                        setMessage(null)
                      }}
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-brand-700"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(badge)}
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-brand-700"
                    >
                      {badge.isActive ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBadge(badge)}
                      className="rounded-full border border-rose-200 px-4 py-2 text-sm font-black text-rose-600"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function BadgeForm({
  tours,
  initial,
  submitLabel,
  onUploadIcon,
  onCancel,
  onSubmit,
}: {
  tours: TourOption[]
  initial: FormState
  submitLabel: string
  onUploadIcon: (file: File, onUrl: (url: string) => void) => void
  onCancel: () => void
  onSubmit: (form: FormState) => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [iconUploading, setIconUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleIconChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setIconUploading(true)
    await onUploadIcon(file, (url) => update('iconUrl', url))
    setIconUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <form
      className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(form)
      }}
    >
      <div>
        <label className="text-xs font-black text-slate-500">名称 *</label>
        <input
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          maxLength={40}
          required
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="例如：DUO 演唱会纪念章"
        />
      </div>
      <div>
        <label className="text-xs font-black text-slate-500">描述</label>
        <textarea
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          maxLength={200}
          rows={2}
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="徽章介绍（可选）"
        />
      </div>
      <div>
        <label className="text-xs font-black text-slate-500">关联巡演 *</label>
        <select
          value={form.musicTourId}
          onChange={(e) => update('musicTourId', e.target.value)}
          required
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">请选择巡演</option>
          {tours.map((tour) => (
            <option key={tour.id} value={tour.id}>
              {tour.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs font-black text-slate-500">图标</label>
        <div className="mt-1 flex items-center gap-3">
          {form.iconUrl ? (
            <img src={form.iconUrl} alt="icon" className="h-12 w-12 rounded-xl object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-2xl">🏅</div>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleIconChange} className="text-sm" />
          {iconUploading ? <span className="text-xs font-bold text-slate-400">上传中…</span> : null}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
        <input type="checkbox" checked={form.isActive} onChange={(e) => update('isActive', e.target.checked)} />
        启用（用户看过对应场次后自动获得）
      </label>
      <div className="flex gap-2">
        <button type="submit" className="rounded-full bg-brand-700 px-5 py-2 text-sm font-black text-white">
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-slate-200 px-5 py-2 text-sm font-black text-slate-600"
        >
          取消
        </button>
      </div>
    </form>
  )
}
