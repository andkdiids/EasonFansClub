import { createWizardId } from './TopicActivityWizardIds'

export type WizardImageStatus = 'EMPTY' | 'SELECTED' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'NEEDS_RESELECT'
export type WizardImage = {
  selectionId: string | null; file: File | null; status: WizardImageStatus
  url: string | null; error: string | null; uploadRequestId: string | null
  fileInfo: { name: string; size: number; type: string } | null
}
export type WizardMedia = { cover: WizardImage; prizes: Record<string, WizardImage> }
export type WizardImageSnapshot = Omit<WizardImage, 'file' | 'uploadRequestId'>
export type WizardMediaSnapshot = { cover: WizardImageSnapshot; prizes: Record<string, WizardImageSnapshot> }

export function emptyWizardImage(): WizardImage {
  return { selectionId: null, file: null, status: 'EMPTY', url: null, error: null, uploadRequestId: null, fileInfo: null }
}
export function createWizardMedia(): WizardMedia { return { cover: emptyWizardImage(), prizes: {} } }
export function selectWizardImage(file?: File): WizardImage {
  return file ? { selectionId: createWizardId('image'), file, status: 'SELECTED', url: null, error: null, uploadRequestId: null,
    fileInfo: { name: file.name, size: file.size, type: file.type } } : emptyWizardImage()
}
/** State transitions only; this module cannot upload. */
export function beginWizardImageUpload(image: WizardImage): WizardImage {
  if (!image.file || !image.selectionId || !['SELECTED', 'FAILED'].includes(image.status)) throw new Error('请先选择待上传图片')
  return { ...image, status: 'UPLOADING', url: null, error: null, uploadRequestId: createWizardId('request') }
}
export function settleWizardImageUpload(image: WizardImage, selectionId: string, requestId: string, result: { url: string } | { error: string }): WizardImage {
  if (image.status !== 'UPLOADING' || image.selectionId !== selectionId || image.uploadRequestId !== requestId) return image
  // URL domain/path validation belongs to the target payload contract, not this transport state.
  if ('error' in result || !result.url.trim() || /^(?:blob|data):/i.test(result.url)) {
    return { ...image, status: 'FAILED', url: null, uploadRequestId: null, error: 'error' in result ? result.error : '上传未返回正式图片地址' }
  }
  return { ...image, status: 'UPLOADED', url: result.url, uploadRequestId: null, error: null }
}
export function snapshotWizardMedia(media: WizardMedia): WizardMediaSnapshot {
  const copy = (image: WizardImage): WizardImageSnapshot => ({
    selectionId: image.selectionId, error: image.error, fileInfo: image.fileInfo ? { ...image.fileInfo } : null,
    status: image.status === 'EMPTY' || image.status === 'UPLOADED' ? image.status : 'NEEDS_RESELECT',
    url: image.status === 'UPLOADED' ? image.url : null,
  })
  return { cover: copy(media.cover), prizes: Object.fromEntries(Object.entries(media.prizes).map(([id, image]) => [id, copy(image)])) }
}
export function restoreWizardMedia(snapshot: WizardMediaSnapshot): WizardMedia {
  const copy = (image: WizardImageSnapshot): WizardImage => ({ ...structuredClone(image), file: null, uploadRequestId: null,
    status: image.status === 'EMPTY' || image.status === 'UPLOADED' ? image.status : 'NEEDS_RESELECT',
    url: image.status === 'UPLOADED' ? image.url : null,
  })
  return { cover: copy(snapshot.cover), prizes: Object.fromEntries(Object.entries(snapshot.prizes).map(([id, image]) => [id, copy(image)])) }
}
