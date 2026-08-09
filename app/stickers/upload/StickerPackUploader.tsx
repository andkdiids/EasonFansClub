'use client'

import Link from 'next/link'
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  isSupportedStickerFile,
  STICKER_FILE_TOO_LARGE_MESSAGE,
  STICKER_MAX_FILE_SIZE,
  STICKER_UPLOAD_ACCEPT,
} from '@/lib/sticker-upload-constraints'

type StickerType = 'STATIC' | 'GIF'

type StickerFile = {
  id: string
  file: File
  preview: string
  name: string
}

const MAX_FILES = 60
const MIN_FILES = 6

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function StickerPackUploader() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [copyright, setCopyright] = useState('')
  const [category, setCategory] = useState('')
  const [cover, setCover] = useState<{ file: File; preview: string } | null>(null)
  const [stickerFiles, setStickerFiles] = useState<StickerFile[]>([])
  const [stickerType, setStickerType] = useState<StickerType>('STATIC')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ packId: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(async (rawFiles: FileList | File[]) => {
    const list = Array.from(rawFiles)
    const accepted: StickerFile[] = []
    for (const f of list) {
      if (stickerFiles.length + accepted.length >= MAX_FILES) break
      if (f.size === 0) continue
      if (f.size > STICKER_MAX_FILE_SIZE) {
        setError(STICKER_FILE_TOO_LARGE_MESSAGE)
        continue
      }
      if (!isSupportedStickerFile(f)) {
        setError('仅支持 JPG / PNG / APNG / WebP / GIF 格式')
        continue
      }
      const preview = await readAsDataUrl(f)
      accepted.push({ id: `${f.name}-${f.size}-${Math.random()}`, file: f, preview, name: '' })
    }
    if (!accepted.length) return
    setError(null)
    setStickerFiles((prev) => [...prev, ...accepted])
  }, [stickerFiles.length])

  function onStickerPick(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      void handleFiles(event.target.files)
      event.target.value = ''
    }
  }

  function onDropStickers(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (event.dataTransfer?.files) {
      void handleFiles(event.dataTransfer.files)
    }
  }

  function onCoverPick(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0]
    if (!f) return
    if (f.size > STICKER_MAX_FILE_SIZE) {
      setError(STICKER_FILE_TOO_LARGE_MESSAGE)
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      setError('封面仅支持 JPG / PNG / WebP 格式')
      return
    }
    void (async () => {
      const preview = await readAsDataUrl(f)
      setCover({ file: f, preview })
    })()
  }

  function removeSticker(id: string) {
    setStickerFiles((prev) => prev.filter((s) => s.id !== id))
  }

  function updateStickerName(id: string, value: string) {
    setStickerFiles((prev) => prev.map((s) => (s.id === id ? { ...s, name: value.slice(0, 4) } : s)))
  }

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('请填写表情包名称')
    if (stickerFiles.length < MIN_FILES) return setError(`至少需要 ${MIN_FILES} 张表情（当前 ${stickerFiles.length} 张）`)
    if (stickerFiles.length > MAX_FILES) return setError(`最多 ${MAX_FILES} 张表情`)
    setBusy(true)
    try {
      const form = new FormData()
      form.append('name', name.trim().slice(0, 40))
      form.append('description', description.slice(0, 200))
      form.append('copyright', copyright.slice(0, 100))
      form.append('category', category.slice(0, 40))
      form.append('type', stickerType)
      stickerFiles.forEach((s, idx) => {
        form.append('stickerFiles', s.file, `sticker-${idx}-${s.file.name}`)
        form.append('stickerNames', s.name)
      })
      if (cover) form.append('cover', cover.file, cover.file.name)

      const res = await fetch('/api/stickers/upload-pack', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || '提交失败')
      }
      setSubmitted({ packId: data.packId })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (submitted) {
    return (
      <section className="space-y-5 rounded-[28px] border border-sky-100 bg-white p-7 text-center shadow-sm sm:p-10">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-100 text-3xl">🕓</div>
        <h2 className="text-xl font-black text-brand-950">已提交审核，请等待管理员审核</h2>
        <p className="mx-auto max-w-md text-sm font-bold text-slate-600">
          审核完成后你会收到通知。审核期间可在「我的表情库 → 我创建的表情包」中查看进度。
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/profile/stickers" className="flat-button-primary">查看我的表情包</Link>
          <Link href="/stickers" className="flat-button-secondary">浏览表情商店</Link>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {/* 类型 */}
      <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-6">
          <span className="text-sm font-black text-slate-700">类型</span>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="radio"
              value="STATIC"
              checked={stickerType === 'STATIC'}
              onChange={() => setStickerType('STATIC')}
              className="h-4 w-4"
            />
            静态表情
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="radio"
              value="GIF"
              checked={stickerType === 'GIF'}
              onChange={() => setStickerType('GIF')}
              className="h-4 w-4"
            />
            动态表情
          </label>
          <span className="text-xs text-slate-400">（按文件实际内容自动识别，支持 GIF / Animated WebP / APNG）</span>
        </div>
      </section>

      {/* 上传区 */}
      <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="text-sm font-black text-slate-700">表情</span>
          <span className="text-xs text-slate-400">JPG / PNG / WebP / GIF 格式，单个 ≤ 20MB，至少 {MIN_FILES} 张</span>
        </div>
        <div
          className="mt-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm font-bold text-slate-500"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropStickers}
        >
          <p>可将表情文件拖拽到此处</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 rounded-full bg-brand-700 px-5 py-2 text-sm font-black text-white"
          >
            选择文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={STICKER_UPLOAD_ACCEPT}
            className="hidden"
            onChange={onStickerPick}
          />
          <p className="mt-2 text-xs font-bold text-slate-400">已选择 {stickerFiles.length} 张</p>
        </div>

        {stickerFiles.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {stickerFiles.map((s, idx) => (
              <div key={s.id} className="relative flex flex-col items-center rounded-2xl border border-slate-100 bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.preview} alt="" className="h-16 w-16 rounded-lg object-contain" />
                <input
                  type="text"
                  value={s.name}
                  maxLength={4}
                  placeholder={`#${idx + 1}`}
                  onChange={(e) => updateStickerName(s.id, e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-1 py-0.5 text-center text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeSticker(s.id)}
                  className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs font-black text-white shadow"
                  aria-label="移除表情"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* 基本信息 */}
      <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm">
        <h2 className="text-base font-black text-brand-950">填写基本信息</h2>
        <div className="mt-4 grid gap-4">
          <Field label="名称" required>
            <input
              type="text"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="填写表情专辑名称"
              className="auth-input w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mt-0.5 text-right text-[11px] text-slate-400">{name.length} / 40</p>
          </Field>
          <Field label="简介">
            <textarea
              maxLength={200}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述表情包的特点和故事"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mt-0.5 text-right text-[11px] text-slate-400">{description.length} / 200</p>
          </Field>
          <Field label="版权">
            <input
              type="text"
              maxLength={100}
              value={copyright}
              onChange={(e) => setCopyright(e.target.value)}
              placeholder="填写版权信息"
              className="auth-input w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="分类">
            <input
              type="text"
              maxLength={40}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="如：情侣、可爱、搞笑（可留空）"
              className="auth-input w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </section>

      {/* 封面 */}
      <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm">
        <h2 className="text-base font-black text-brand-950">封面</h2>
        <p className="mt-1 text-xs font-bold text-slate-400">推荐 JPG 或 PNG 格式，至少 600×600；会作为表情商店与详情页主图。</p>
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-600"
          >
            {cover ? '更换封面' : '选择封面'}
          </button>
          <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onCoverPick} />
          {cover ? (
            <div className="relative h-24 w-24 overflow-hidden rounded-xl ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover.preview} alt="封面预览" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setCover(null)}
                className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-xs text-white"
                aria-label="移除封面"
              >
                ×
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-400">未选</span>
          )}
        </div>
      </section>

      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-bold text-red-600">{error}</p> : null}

      <div className="flex items-center justify-end gap-3">
        <Link href="/stickers" className="flat-button-secondary">取消</Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="flat-button-primary disabled:opacity-50"
        >
          {busy ? '提交中…' : '提交审核'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-sm font-black text-slate-700">
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </p>
      {children}
    </div>
  )
}
