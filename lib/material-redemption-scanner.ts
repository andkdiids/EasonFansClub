export type MaterialRedemptionScannerControls = { stop: () => void }

export type MaterialRedemptionCameraStream = {
  getTracks: () => Array<{ stop: () => void }>
}

export function stopMaterialRedemptionCamera(
  stream: MaterialRedemptionCameraStream | null,
  controls?: MaterialRedemptionScannerControls | null,
) {
  try {
    controls?.stop()
  } catch {
    // The browser scanner may already have stopped itself.
  }
  stream?.getTracks().forEach((track) => track.stop())
}

export function getMaterialRedemptionCameraErrorMessage(error: unknown) {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return '没有摄像头权限，请允许浏览器访问摄像头，或使用兑换码手动核销。'
  if (name === 'NotFoundError') return '当前设备没有可用摄像头，请使用兑换码核销。'
  if (name === 'NotReadableError' || name === 'AbortError') return '摄像头暂时无法使用，请关闭其他正在使用摄像头的应用后重试。'
  return '当前浏览器暂不支持摄像头扫码，请使用兑换码核销。'
}
