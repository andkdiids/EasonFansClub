'use client'

import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'

export function ActivityRegistrationQr({ activityId, token, verifiedAt = null }: Readonly<{ activityId: string; token: string; verifiedAt?: string | null }>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState('')
  const isVerified = Boolean(verifiedAt)
  useEffect(() => {
    if (!canvasRef.current || !token) return
    const value = `${window.location.origin}/admin/activities/${encodeURIComponent(activityId)}/verify?token=${encodeURIComponent(token)}`
    QRCode.toCanvas(canvasRef.current, value, { width: 220, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b1f35', light: '#ffffff' } })
      .then(() => setError(''))
      .catch(() => setError('二维码生成失败，请联系管理员手动核销'))
  }, [activityId, token])
  return <div className="flex flex-wrap items-center gap-4"><div className="relative grid min-h-56 min-w-56 place-items-center overflow-hidden rounded-xl border border-[var(--border)] bg-white p-3 lg:aspect-square lg:min-h-0 lg:min-w-0 lg:w-full lg:max-w-64" data-registration-qr-state={isVerified ? 'verified' : 'active'}>{error ? <p className="max-w-48 text-center text-xs font-bold text-rose-600">{error}</p> : <canvas ref={canvasRef} className={isVerified ? 'pointer-events-none grayscale opacity-40' : undefined} aria-label={isVerified ? '已核销的活动报名核销二维码' : '活动报名核销二维码'} />}{isVerified ? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-100/75 dark:bg-slate-800/80"><span className="inline-flex items-center gap-1 border border-emerald-700/40 bg-white/85 px-3 py-2 text-sm font-black text-emerald-700 dark:border-emerald-300/40 dark:bg-slate-950/85 dark:text-emerald-300"><span aria-hidden="true">✓</span>已核销</span></div> : null}</div><p className="max-w-xs text-xs font-bold leading-5 text-[var(--foreground-muted)]">到场时向工作人员展示此二维码。二维码只用于核验报名，不会直接完成其他操作。</p></div>
}
