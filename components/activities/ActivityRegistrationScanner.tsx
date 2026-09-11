'use client'

import { useEffect, useRef, useState } from 'react'

type BarcodeDetectorResult = { rawValue?: string }
type BarcodeDetectorInstance = { detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]> }
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance

const CAMERA_ERROR = '无法使用摄像头\n请允许浏览器访问摄像头，或使用手动输入核销码。'

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    try { track.stop() } catch { /* A stopped track is already cleaned up. */ }
  })
}

function errorName(error: unknown) {
  return error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : ''
}

function cameraErrorMessage(error: unknown) {
  const name = errorName(error)
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return CAMERA_ERROR
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '未找到可用摄像头。\n请检查设备权限，或使用手动输入核销码。'
  return CAMERA_ERROR
}

export function ActivityRegistrationScanner({
  open,
  onClose,
  onScan,
  onManualInput,
}: Readonly<{
  open: boolean
  onClose: () => void
  onScan: (value: string) => void
  onManualInput?: () => void
}>) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const detectionTimerRef = useRef<number | null>(null)
  const onScanRef = useRef(onScan)
  const scanLockRef = useRef(false)
  const [error, setError] = useState('')
  const [decoder, setDecoder] = useState<'native' | 'fallback' | null>(null)

  useEffect(() => { onScanRef.current = onScan }, [onScan])

  useEffect(() => {
    if (!open) return
    const video = videoRef.current
    if (!video) return

    let disposed = false
    let fallbackStarted = false

    const cleanup = () => {
      if (detectionTimerRef.current !== null) {
        window.clearTimeout(detectionTimerRef.current)
        detectionTimerRef.current = null
      }
      try { controlsRef.current?.stop() } catch { /* The decoder may already be stopped. */ }
      controlsRef.current = null
      const stream = streamRef.current
      streamRef.current = null
      stopMediaStream(stream)
      video.pause()
      video.srcObject = null
    }

    const finish = (rawValue: string) => {
      const value = rawValue.trim()
      if (disposed || scanLockRef.current || !value) return
      scanLockRef.current = true
      disposed = true
      cleanup()
      try {
        if (typeof navigator.vibrate === 'function') navigator.vibrate(100)
      } catch { /* Vibration is optional and can be rejected by the browser. */ }
      onScanRef.current(value)
    }

    const startFallback = async () => {
      if (disposed || fallbackStarted || !streamRef.current) return
      fallbackStarted = true
      setDecoder('fallback')
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        const reader = new BrowserQRCodeReader()
        const controls = await reader.decodeFromStream(streamRef.current, video, (result) => {
          if (result) finish(result.getText())
        })
        if (disposed) controls.stop()
        else controlsRef.current = controls
      } catch (fallbackError) {
        if (!disposed) {
          cleanup()
          setError(cameraErrorMessage(fallbackError))
        }
      }
    }

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('MEDIA_DEVICES_UNAVAILABLE')
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
        if (disposed) {
          stopMediaStream(stream)
          return
        }
        streamRef.current = stream
        video.srcObject = stream
        await video.play().catch(() => undefined)
        if (disposed) return

        const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
        if (!Detector) {
          await startFallback()
          return
        }

        let detector: BarcodeDetectorInstance
        try {
          detector = new Detector({ formats: ['qr_code'] })
        } catch {
          await startFallback()
          return
        }

        setDecoder('native')
        let detectionInFlight = false
        const detect = async () => {
          if (disposed) return
          if (!detectionInFlight && video.readyState >= 2) {
            detectionInFlight = true
            try {
              const results = await detector.detect(video)
              const value = results.find((result) => typeof result.rawValue === 'string' && result.rawValue.trim())?.rawValue
              if (value) {
                finish(value)
                return
              }
            } catch (detectionError) {
              if (errorName(detectionError) === 'NotSupportedError') {
                await startFallback()
                return
              }
            } finally {
              detectionInFlight = false
            }
          }
          if (!disposed) detectionTimerRef.current = window.setTimeout(() => { void detect() }, 140)
        }
        void detect()
      } catch (cameraError) {
        if (!disposed) {
          cleanup()
          setError(cameraErrorMessage(cameraError))
        }
      }
    }

    setError('')
    setDecoder(null)
    scanLockRef.current = false
    void start()
    return () => {
      disposed = true
      cleanup()
    }
  }, [open])

  if (!open) return null

  return <div className="fixed inset-0 z-[120] flex min-h-[100dvh] flex-col overflow-y-auto bg-slate-950 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] text-white" role="dialog" aria-modal="true" aria-label="活动核销扫码">
    <header className="flex min-h-12 items-center justify-between gap-3 border-b border-white/10">
      <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-black text-white/85 hover:bg-white/10" aria-label="返回">‹ 返回</button>
      <span className="text-sm font-black">活动核销</span>
      <span className="w-16" aria-hidden="true" />
    </header>
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center py-6">
      <div className="relative w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/40">
        <video ref={videoRef} autoPlay muted playsInline className="block aspect-video h-auto max-h-[62dvh] w-full object-cover sm:aspect-[4/3]" aria-label="活动报名二维码摄像头画面" />
        <div className="pointer-events-none absolute inset-[12%] rounded-xl border-2 border-white/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]" aria-hidden="true">
          <span className="absolute -left-0.5 -top-0.5 h-8 w-8 border-l-4 border-t-4 border-emerald-300" />
          <span className="absolute -right-0.5 -top-0.5 h-8 w-8 border-r-4 border-t-4 border-emerald-300" />
          <span className="absolute -bottom-0.5 -left-0.5 h-8 w-8 border-b-4 border-l-4 border-emerald-300" />
          <span className="absolute -bottom-0.5 -right-0.5 h-8 w-8 border-b-4 border-r-4 border-emerald-300" />
        </div>
      </div>
      <p className="mt-5 text-center text-base font-black">将报名二维码放入框内</p>
      <p className="mt-2 text-center text-xs font-bold text-white/60">{error ? '摄像头暂不可用' : decoder === 'fallback' ? '正在使用兼容扫码模式' : '正在识别二维码'}</p>
      {error ? <p role="alert" className="mt-4 w-full whitespace-pre-line rounded-xl border border-rose-300/40 bg-rose-950/60 px-4 py-3 text-center text-sm font-black leading-6 text-rose-100">{error}</p> : null}
    </div>
    <div className="mx-auto grid w-full max-w-xl gap-2 sm:grid-cols-2">
      <button type="button" onClick={onClose} className="min-h-12 rounded-full border border-white/25 px-5 py-3 text-sm font-black text-white">关闭摄像头</button>
      {onManualInput ? <button type="button" onClick={onManualInput} className="min-h-12 rounded-full bg-white px-5 py-3 text-sm font-black text-slate-950">手动输入核销码</button> : null}
    </div>
  </div>
}
