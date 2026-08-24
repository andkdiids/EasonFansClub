'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseMaterialRedemptionQr } from '@/lib/material-redemption-domain'
import {
  getMaterialRedemptionCameraErrorMessage,
  stopMaterialRedemptionCamera,
  type MaterialRedemptionScannerControls,
  type MaterialRedemptionCameraStream,
} from '@/lib/material-redemption-scanner'

type BarcodeResult = { rawValue?: string }
type BarcodeDetectorReader = { detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]> }
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorReader
  getSupportedFormats?: () => Promise<string[]>
}
type ScannerWindow = Window & { BarcodeDetector?: BarcodeDetectorConstructor }

function getScannerIdentifier(value: ReturnType<typeof parseMaterialRedemptionQr>) {
  if (!value) return ''
  return value.redeemToken || value.redeemCode || ''
}

function getBarcodeDetectorConstructor() {
  return (window as ScannerWindow).BarcodeDetector || null
}

export function MaterialRedemptionScanner({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (identifier: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MaterialRedemptionCameraStream | null>(null)
  const controlsRef = useRef<MaterialRedemptionScannerControls | null>(null)
  const nativeTimerRef = useRef<number | null>(null)
  const nativeDetectorRef = useRef<BarcodeDetectorReader | null>(null)
  const nativeScanInFlightRef = useRef(false)
  const scanningLockedRef = useRef(false)
  const cameraSessionRef = useRef(0)
  const lastInvalidValueRef = useRef('')
  const onCloseRef = useRef(onClose)
  const onScanRef = useRef(onScan)
  const [scannerError, setScannerError] = useState('')

  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { onScanRef.current = onScan }, [onScan])

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1
    if (nativeTimerRef.current !== null) window.clearInterval(nativeTimerRef.current)
    nativeTimerRef.current = null
    nativeDetectorRef.current = null
    nativeScanInFlightRef.current = false
    stopMaterialRedemptionCamera(streamRef.current, controlsRef.current)
    streamRef.current = null
    controlsRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const closeScanner = useCallback(() => {
    stopCamera()
    onCloseRef.current()
  }, [stopCamera])

  const handleDecodedValue = useCallback((rawValue: string) => {
    if (scanningLockedRef.current) return
    const parsed = parseMaterialRedemptionQr(rawValue)
    const identifier = getScannerIdentifier(parsed)
    if (!identifier) {
      if (lastInvalidValueRef.current !== rawValue) {
        lastInvalidValueRef.current = rawValue
        setScannerError('二维码内容不受支持，请扫描物料兑换二维码。')
      }
      return
    }
    scanningLockedRef.current = true
    stopCamera()
    onCloseRef.current()
    onScanRef.current(identifier)
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    const cameraSession = cameraSessionRef.current + 1
    cameraSessionRef.current = cameraSession
    const isCurrentSession = () => cameraSessionRef.current === cameraSession && !scanningLockedRef.current
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext && !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
      setScannerError('当前浏览器暂不支持摄像头扫码，请使用兑换码核销。')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      const video = videoRef.current
      if (!video || !isCurrentSession()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      if (!isCurrentSession()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const detectorConstructor = getBarcodeDetectorConstructor()
      let nativeDetector: BarcodeDetectorReader | null = null
      if (detectorConstructor) {
        try {
          const supportedFormats = detectorConstructor.getSupportedFormats ? await detectorConstructor.getSupportedFormats() : ['qr_code']
          if (supportedFormats.includes('qr_code')) nativeDetector = new detectorConstructor({ formats: ['qr_code'] })
        } catch {
          nativeDetector = null
        }
      }

      if (!isCurrentSession()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      if (nativeDetector) {
        nativeDetectorRef.current = nativeDetector
        nativeTimerRef.current = window.setInterval(() => {
          const video = videoRef.current
          const detector = nativeDetectorRef.current
          if (!video || !detector || scanningLockedRef.current || nativeScanInFlightRef.current || video.readyState < 2) return
          nativeScanInFlightRef.current = true
          void detector.detect(video)
            .then((results) => {
              const rawValue = results.find((result) => result.rawValue)?.rawValue
              if (rawValue) handleDecodedValue(rawValue)
            })
            .catch(() => {
              // A single unreadable frame is normal; keep scanning subsequent frames.
            })
            .finally(() => { nativeScanInFlightRef.current = false })
        }, 140)
        return
      }

      const { BrowserQRCodeReader } = await import('@zxing/browser')
      if (!isCurrentSession()) return
      const reader = new BrowserQRCodeReader()
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        if (result) handleDecodedValue(result.getText())
      })
      if (!isCurrentSession()) controls.stop()
      else controlsRef.current = controls
    } catch (error) {
      if (cameraSessionRef.current !== cameraSession) return
      stopCamera()
      setScannerError(getMaterialRedemptionCameraErrorMessage(error))
    }
  }, [handleDecodedValue, stopCamera])

  useEffect(() => {
    if (!open) {
      stopCamera()
      return
    }
    scanningLockedRef.current = false
    lastInvalidValueRef.current = ''
    setScannerError('')
    void startCamera()
    return () => stopCamera()
  }, [open, startCamera, stopCamera])

  if (!open) return null

  return (
    <div className="material-redemption-scanner" role="dialog" aria-modal="true" aria-labelledby="material-redemption-scanner-title">
      <div className="material-redemption-scanner-panel">
        <header className="material-redemption-scanner-header">
          <div>
            <p className="material-redemption-scanner-kicker">现场核销</p>
            <h2 id="material-redemption-scanner-title">扫码核销</h2>
          </div>
          <button type="button" className="material-redemption-scanner-close" onClick={closeScanner} aria-label="关闭扫码">×</button>
        </header>
        <div className="material-redemption-scanner-viewport">
          <video ref={videoRef} autoPlay muted playsInline aria-label="兑换二维码摄像头画面" />
          <div className="material-redemption-scanner-frame" aria-hidden="true"><i /><i /><i /><i /></div>
          <p>请将兑换二维码放入框内</p>
        </div>
        {scannerError ? <p className="material-redemption-scanner-error" role="alert">{scannerError}</p> : <p className="material-redemption-scanner-hint">扫码只查询订单，确认交付后才会核销。</p>}
        <button type="button" className="material-redemption-scanner-cancel" onClick={closeScanner}>关闭扫码</button>
      </div>
    </div>
  )
}
