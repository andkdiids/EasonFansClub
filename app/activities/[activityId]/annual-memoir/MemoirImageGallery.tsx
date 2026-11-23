'use client'

import { useEffect, useState } from 'react'
import { memoirChapters } from '@/lib/annual-memoir-art'

export function MemoirImageGallery({ files, close }: { files: File[]; close: () => void }) {
  const [index, setIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const file = files[index]
  const [source, setSource] = useState<{ file: File; url: string }>()
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSource({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])
  const url = source?.file === file ? source.url : undefined
  const canShare = typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })

  return <section aria-label="年度回忆图片" className="memoir-gallery">
    <header><button type="button" onClick={close}>‹ 返回画册</button><span>{index + 1} / {files.length}</span></header>
    <div className="memoir-gallery-image">
      {/* A native image preserves the browser's image context menu. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt={memoirChapters[index]} width={1080} height={1920} draggable={false} />}
    </div>
    <footer>
      <p>长按图片，保存到相册</p>
      <div>
        <button disabled={index === 0} onClick={() => { setIndex(index - 1); setNotice('') }}>上一张</button>
        {canShare && <button onClick={() => {
          void navigator.share({ files: [file] }).catch((error: unknown) => {
            if (!(error instanceof Error) || error.name !== 'AbortError') setNotice('可尝试长按图片保存。')
          })
        }}>打开系统分享</button>}
        <button disabled={index === files.length - 1} onClick={() => { setIndex(index + 1); setNotice('') }}>下一张</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </footer>
  </section>
}
