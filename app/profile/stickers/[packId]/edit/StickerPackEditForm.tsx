'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type ChangeEvent } from 'react'
import { publicImageVariantUrl } from '@/lib/image-variants'

import {
  isSupportedStickerFile,
  STICKER_FILE_TOO_LARGE_MESSAGE,
  STICKER_MAX_FILE_SIZE,
  STICKER_UPLOAD_ACCEPT,
} from '@/lib/sticker-upload-constraints'

type StickerStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

type EditSticker = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  sort: number
}

type EditPack = {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  type: 'STATIC' | 'GIF'
  status: StickerStatus
  rejectionReason: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
  category: string | null
  stickers: EditSticker[]
}

const MAX_FILES = 60
const MIN_FILES = 6
const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

function getExtension(file: File) {
  return file.name.toLowerCase().split('.').pop() || ''
}

function isStaticCoverCandidate(file: File) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase()) || COVER_EXTENSIONS.has(getExtension(file))
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function StickerPackEditForm({ initialPack }: { initialPack: EditPack }) {
  const router = useRouter()
  const [pack, setPack] = useState(initialPack)
  const [name, setName] = useState(initialPack.name)
  const [description, setDescription] = useState(initialPack.description || '')
  const [category, setCategory] = useState(initialPack.category || '')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(initialPack.coverUrl)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const editable = pack.status === 'REJECTED'
  const stickerCount = pack.stickers.length

  async function savePack(): Promise<boolean> {
    if (!editable) return false
    if (!name.trim()) {
      setError('请填写表情包名称')
      return false
    }

    setError(null)
    setMessage(null)
    setBusy('save')
    try {
      const form = new FormData()
      form.append('name', name.trim().slice(0, 40))
      form.append('description', description.slice(0, 200))
      form.append('category', category.slice(0, 40))
      if (coverFile) form.append('cover', coverFile, coverFile.name)

      const response = await fetch(`/api/stickers/my/${pack.id}`, { method: 'PATCH', body: form })
      const data = await response.json().catch(() => null) as { message?: string; pack?: EditPack } | null
      if (!response.ok || !data?.pack) throw new Error(data?.message || '保存失败')

      setPack(data.pack)
      setName(data.pack.name)
      setDescription(data.pack.description || '')
      setCategory(data.pack.category || '')
      setCoverPreview(data.pack.coverUrl)
      setCoverFile(null)
      setMessage('草稿已保存')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function removeSticker(stickerId: string) {
    if (!editable || busy) return
    if (!confirm('确定删除这张表情吗？其他表情和原合集不会受影响。')) return
    setError(null)
    setMessage(null)
    setBusy(`delete:${stickerId}`)
    try {
      const response = await fetch(`/api/stickers/${stickerId}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '删除失败')
      setPack((current) => ({ ...current, stickers: current.stickers.filter((sticker) => sticker.id !== stickerId) }))
      setMessage('已删除这张表情，其他表情保持不变')
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  async function addStickers(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!editable || !files.length) return
    if (stickerCount + files.length > MAX_FILES) {
      setError(`最多 ${MAX_FILES} 张表情，请分批添加`)
      return
    }

    setError(null)
    setMessage(null)
    setBusy('add')
    try {
      for (const file of files) {
        if (file.size === 0) throw new Error('请选择有效的表情文件')
        if (file.size > STICKER_MAX_FILE_SIZE) throw new Error(STICKER_FILE_TOO_LARGE_MESSAGE)
        if (!isSupportedStickerFile(file)) throw new Error('仅支持 JPG / PNG / APNG / WebP / GIF 格式')

        const form = new FormData()
        form.append('file', file, file.name)
        form.append('type', pack.type)
        const response = await fetch(`/api/stickers/my/${pack.id}/stickers`, { method: 'POST', body: form })
        const data = await response.json().catch(() => null) as { message?: string; sticker?: EditSticker } | null
        if (!response.ok || !data?.sticker) throw new Error(data?.message || '新增表情失败')
        setPack((current) => ({ ...current, stickers: [...current.stickers, data.sticker!] }))
      }
      setMessage(`已新增 ${files.length} 张表情，原有表情文件继续复用`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增表情失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  async function chooseCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isStaticCoverCandidate(file)) {
      setError('封面仅支持静态 JPG / PNG / WebP 图片')
      return
    }
    if (file.size > STICKER_MAX_FILE_SIZE) {
      setError(STICKER_FILE_TOO_LARGE_MESSAGE)
      return
    }
    try {
      setCoverFile(file)
      setCoverPreview(await readAsDataUrl(file))
      setError(null)
      setMessage('封面已更换，点击保存草稿后生效')
    } catch {
      setError('封面预览失败，请重新选择')
    }
  }

  async function resubmit() {
    if (!editable || busy) return
    if (stickerCount < MIN_FILES) {
      setError(`一个表情包合集至少需要 ${MIN_FILES} 张表情，请补充后再提交审核`)
      return
    }
    if (stickerCount > MAX_FILES) {
      setError(`一个表情包合集最多 ${MAX_FILES} 张表情`)
      return
    }

    const saved = await savePack()
    if (!saved) return

    setError(null)
    setMessage(null)
    setBusy('submit')
    try {
      const response = await fetch(`/api/stickers/my/${pack.id}/submit`, { method: 'POST' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '重新提交失败')
      setPack((current) => ({ ...current, status: 'PENDING' }))
      setMessage('已重新提交，正在等待管理员审核')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新提交失败，请稍后重试')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      {pack.status === 'REJECTED' ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm">
          <p className="text-lg font-black">审核未通过</p>
          <p className="mt-2 text-sm font-black">管理员反馈：</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm font-bold leading-6">{pack.rejectionReason || '请根据审核意见修改后重新提交。'}</p>
        </section>
      ) : pack.status === 'PENDING' ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-800 shadow-sm">
          <p className="text-lg font-black">正在审核</p>
          <p className="mt-1 text-sm font-bold leading-6">该表情包已重新提交，正在等待审核。审核期间页面为只读，不能删除、新增或修改内容。</p>
        </section>
      ) : (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800 shadow-sm">
          <p className="text-lg font-black">审核已通过</p>
          <p className="mt-1 text-sm font-bold leading-6">该表情包已经审核通过，用户编辑入口已关闭。</p>
          <Link href={`/stickers/${pack.id}`} className="mt-3 inline-flex flat-button-secondary">查看公开详情</Link>
        </section>
      )}

      <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-black text-brand-950">合集信息</h2>
        <div className="mt-4 grid gap-4">
          <label className="text-sm font-black text-slate-700">
            名称
            <input value={name} maxLength={40} disabled={!editable} onChange={(event) => setName(event.target.value)} className="auth-input mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400" />
          </label>
          <label className="text-sm font-black text-slate-700">
            简介
            <textarea value={description} maxLength={200} disabled={!editable} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400" />
          </label>
          <label className="text-sm font-black text-slate-700">
            分类
            <input value={category} maxLength={40} disabled={!editable} onChange={(event) => setCategory(event.target.value)} className="auth-input mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400" />
          </label>
          <div>
            <p className="text-sm font-black text-slate-700">封面</p>
            <p className="mt-1 text-xs font-bold text-slate-400">封面必须是静态 JPG、PNG 或 WebP 图片。</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className={`inline-flex cursor-pointer rounded-full px-4 py-2 text-sm font-black ${editable ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-slate-50 text-slate-400'}`}>
                {coverFile ? '重新选择封面' : '更换封面'}
                <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={!editable} onChange={(event) => void chooseCover(event)} className="hidden" />
              </label>
              {coverPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverPreview} alt="表情包封面" className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200" />
              ) : <span className="text-xs font-bold text-red-500">未设置封面</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-brand-950">表情列表</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">当前 {stickerCount} / {MAX_FILES} 张；未修改的表情不会重新上传。</p>
          </div>
          {editable ? (
            <label className="inline-flex cursor-pointer rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white hover:bg-brand-800">
              {busy === 'add' ? '上传中…' : '添加表情'}
              <input type="file" multiple accept={STICKER_UPLOAD_ACCEPT} disabled={Boolean(busy)} onChange={(event) => void addStickers(event)} className="hidden" />
            </label>
          ) : null}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {pack.stickers.map((sticker, index) => (
            <div key={sticker.id} className="relative flex min-w-0 flex-col items-center rounded-2xl border border-slate-100 bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicImageVariantUrl(sticker.url, 'thumb-sm') || sticker.url} alt={sticker.name || `第 ${index + 1} 张表情`} className="h-20 w-20 rounded-lg object-contain" loading="lazy" />
              <p className="mt-1 w-full truncate text-center text-[11px] font-bold text-slate-500">{sticker.name || `第 ${index + 1} 张`}</p>
              {editable ? (
                <button type="button" disabled={Boolean(busy)} onClick={() => void removeSticker(sticker.id)} className="mt-1 rounded-full px-2 py-1 text-[11px] font-black text-red-600 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50">
                  {busy === `delete:${sticker.id}` ? '删除中…' : '删除'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}
      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/profile/stickers" className="flat-button-secondary">返回我的表情包</Link>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => void savePack()} className="flat-button-secondary disabled:opacity-50">
              {busy === 'save' ? '保存中…' : '保存草稿'}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void resubmit()} className="flat-button-primary disabled:opacity-50">
              {busy === 'submit' ? '提交中…' : '重新提交审核'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
