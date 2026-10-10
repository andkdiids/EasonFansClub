'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'

/** Same protected endpoint for downloads and inline previews; no public COS URL. */
export function TopicActivityOriginalImage({ originalUrl }: { originalUrl: string }) {
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [authorizedUrl, setAuthorizedUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestLock = useRef(false)
  const alive = useRef(true)
  const previewObjectUrl = useRef<string | null>(null)
  const requestController = useRef<AbortController | null>(null)
  const requestGeneration = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      requestGeneration.current += 1
      requestController.current?.abort()
      requestController.current = null
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
      previewObjectUrl.current = null
    }
  }, [])

  function clearPreviewObjectUrl() {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
    previewObjectUrl.current = null
    setPreviewUrl('')
  }

  function closePreview() {
    setOpen(false)
    requestGeneration.current += 1
    requestController.current?.abort()
    requestController.current = null
    clearPreviewObjectUrl()
  }

  async function requestOriginal(event: MouseEvent<HTMLElement>, forcePreview = false) {
    event.preventDefault()
    if (requestLock.current) return
    requestLock.current = true
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    const controller = new AbortController()
    requestController.current = controller
    setBusy(true); setError(''); setNotice('')
    clearPreviewObjectUrl(); setAuthorizedUrl('')
    const wechat = /MicroMessenger/i.test(navigator.userAgent)
    const previewOnly = forcePreview || wechat
    if (previewOnly) setOpen(true)
    try {
      const url = new URL(originalUrl, window.location.origin)
      if (url.origin !== window.location.origin || !/^\/api\/activities\/[^/]+\/form-submissions\/.+\/original$/.test(url.pathname)) throw new Error('原图地址无效')
      url.searchParams.set('view', '1')
      const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.message || (response.status === 401 ? '请登录后查看原图' : '原图暂时无法加载，请重试'))
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/')) throw new Error('原图响应无效，请重新登录或稍后重试')
      // blob() preserves the original bytes; never draw onto a canvas/re-encode.
      const blob = await response.blob()
      if (!blob.size) throw new Error('原图为空，请重试')
      if (!alive.current || generation !== requestGeneration.current || controller.signal.aborted) return
      setAuthorizedUrl(url.pathname + url.search)
      if (previewOnly) {
        clearPreviewObjectUrl()
        // Display the already-authorized, byte-identical Blob. Do not make a
        // second full image request (or depend on a second WebView auth pass).
        previewObjectUrl.current = URL.createObjectURL(blob)
        setPreviewUrl(previewObjectUrl.current)
        setNotice(wechat ? '长按下方原图尝试保存。如微信不支持保存此格式，请点击右上角菜单，用系统浏览器打开本页后下载；可能需要重新登录。' : '原图已加载，可尝试长按保存或打开授权原图。')
      } else {
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        const encodedName = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
        let filename = 'topic-activity-original'
        if (encodedName) { try { filename = decodeURIComponent(encodedName) } catch { /* safe default */ } }
        link.download = filename
        document.body.appendChild(link); link.click(); link.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
        setNotice('已请求浏览器下载。如未开始，请查看授权原图或使用系统浏览器。')
      }
    } catch (cause) {
      if (controller.signal.aborted || generation !== requestGeneration.current) return
      if (alive.current) { setError(cause instanceof Error ? cause.message : '原图加载失败，请重试'); setOpen(true) }
    } finally {
      if (requestController.current === controller) requestController.current = null
      requestLock.current = false
      if (alive.current) setBusy(false)
    }
  }

  return <div className="space-y-1">
    <a href={originalUrl} download onClick={(event) => void requestOriginal(event)} aria-disabled={busy} className="block text-xs font-bold text-[var(--primary)] underline">{busy ? '原图加载中…' : '下载原图'}</a>
    {notice && !open ? <p role="status" className="max-w-xs text-xs text-[var(--foreground-muted)]">{notice} <button type="button" onClick={(event) => void requestOriginal(event, true)} className="underline">查看原图</button></p> : null}
    {open ? <div role="dialog" aria-modal="true" aria-label="查看原图" className="fixed inset-0 z-[100] overflow-y-auto bg-[var(--surface)] p-4 text-[var(--foreground)]">
      <div className="mx-auto max-w-3xl space-y-4"><div className="flex items-center justify-between"><h2 className="font-black">授权原图</h2><button type="button" onClick={closePreview} className="min-h-11 border border-[var(--border)] px-4">关闭</button></div>
        {busy ? <p role="status">原图加载中…</p> : null}
        {notice ? <p role="status" className="text-sm leading-6">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
        {previewUrl ? <img src={previewUrl} alt="授权原图，可尝试长按保存" className="h-auto w-full object-contain" onError={() => { clearPreviewObjectUrl(); setError('当前浏览器无法预览此原始格式。请用系统浏览器打开本页下载，原图不会转换或压缩。') }} /> : null}
        {authorizedUrl ? <a href={authorizedUrl} target="_blank" rel="noopener noreferrer" className="block underline">打开授权原图</a> : null}
        <a href={originalUrl} download onClick={(event) => void requestOriginal(event)} aria-disabled={busy} className="inline-block min-h-11 border border-[var(--border)] px-4 py-2">重试下载原图</a>
      </div>
    </div> : null}
  </div>
}
