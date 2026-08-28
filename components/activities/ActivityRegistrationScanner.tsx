'use client'

import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'

export function ActivityRegistrationScanner({ open, onClose, onScan }: Readonly<{ open: boolean; onClose: () => void; onScan: (value: string) => void }>) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    const reader = new BrowserQRCodeReader()
    void reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, videoRef.current!, (result, error) => {
      if (!active) return
      if (result) { active = false; controlsRef.current?.stop(); onScan(result.getText()) }
      else if (error && error.name !== 'NotFoundException') setError('请将活动报名二维码放入框内')
    }).then((controls) => { if (active) controlsRef.current = controls; else controls.stop() }).catch(() => setError('摄像头不可用，请改用报名记录中的手动核销'))
    return () => { active = false; controlsRef.current?.stop(); controlsRef.current = null }
  }, [open, onScan])
  if (!open) return null
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="扫码核销"><div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black text-brand-950 dark:text-slate-100">扫码核销报名</h2><button type="button" onClick={onClose} className="text-2xl text-slate-500" aria-label="关闭">×</button></div><div className="mt-4 overflow-hidden rounded-xl bg-black"><video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" aria-label="活动报名二维码摄像头画面" /></div><p className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300">只会读取令牌，核销仍需服务端校验并记录管理员。</p>{error ? <p className="mt-2 text-sm font-bold text-rose-600">{error}</p> : null}<button type="button" onClick={onClose} className="mt-4 min-h-11 w-full rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">关闭</button></div></div>
}
