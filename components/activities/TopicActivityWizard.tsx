'use client'

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TopicActivityWizardSummary } from './TopicActivityWizardSummary'
import { TopicActivityWizardTestEditor } from './TopicActivityWizardTestEditor'
import { changeTopicWizardEnd, createTopicWizardDraft, toggleTopicWizardPlatform, topicWizardErrors, topicWizardPlatforms, type TopicActivityWizardDraft } from './TopicActivityWizardState'
import { createWizardId } from './TopicActivityWizardIds'
import { beginWizardImageUpload, createWizardMedia, selectWizardImage, settleWizardImageUpload, type WizardImage, type WizardMedia } from './TopicActivityWizardMedia'
import { createWizardSnapshot, restoreWizardSnapshot, WizardSaveSessionController, wizardSaveStages, type WizardSaveSession, type WizardSnapshot } from './TopicActivityWizardSession'
import { prepareWizardActivityPayload, prepareWizardProgramPayload } from './TopicActivityWizardPayload'
import { saveWizardActivityDraft } from './TopicActivityWizardActivitySave'
import { saveWizardProgram } from './TopicActivityWizardProgramSave'
import { saveWizardLottery } from './TopicActivityWizardLotterySave'
import { prepareWizardPublishGate, publishWizardActivity } from './TopicActivityWizardPublish'
import { topicWizardEditInitialState, getTopicWizardEditChanges, saveTopicWizardEdits, type EditPendingVerification, type TopicWizardEditBaseline } from './TopicActivityWizardEdit'
import { uploadActivityImage } from './ActivityImageUploader'
import { storedActivityImageUrl } from '@/lib/activity-image-url'
import { formatBeijingDateTimeInput } from '@/lib/registration-availability'

function dateInputForWizard(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? formatBeijingDateTimeInput(date) || '' : ''
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

const steps = ['活动信息', '参与规则', '测试题', '奖励与抽奖', '检查并保存']
const inputClass = 'mt-1 min-h-11 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm'
const buttonClass = 'min-h-11 rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-bold disabled:opacity-40'
export type TopicWizardBadgeOption = { id: string; name: string }
const saveStageLabels = { UPLOAD: '图片上传', ACTIVITY: '活动草稿', PROGRAM: '话题配置', LOTTERY: '抽奖配置', READBACK: '回读核验', PUBLISH: '发布' }
const saveStatusLabels = { IDLE: '未开始', RUNNING: '请求处理中', SUCCEEDED: '服务器已确认', FAILED: '失败', UNKNOWN: '结果不明，需核对', SKIPPED: '未执行', SIMULATED: '仅模拟完成' }

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return <div className="min-w-0 text-sm font-bold"><label htmlFor={id} className="block">{label}</label>
    {isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}</div>
}

// Local object URLs are preview-only; only the existing authenticated uploader can produce a saved URL.
function WizardImageField({ label, image, currentUrl, disabled, onSelect, onRemove }: {
  label: string; image: WizardImage; currentUrl?: string | null; disabled?: boolean
  onSelect: (file?: File) => void; onRemove: () => void
}) {
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!image.file) { setPreviewUrl(''); return }
    const next = URL.createObjectURL(image.file)
    setPreviewUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [image.file])
  const shownUrl = previewUrl || image.url || currentUrl || null
  return <div className="space-y-2">
    <Field label={label}><input ref={input} className={inputClass} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const selected = event.target.files?.[0]
      if (!selected) return
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size < 1 || selected.size > 5 * 1024 * 1024) {
        setError('请选择非空且不超过 5MB 的 PNG、JPEG 或 WebP 图片'); event.target.value = ''; return
      }
      setError(''); onSelect(selected)
    }} disabled={disabled} /></Field>
    {shownUrl ? <img src={shownUrl} alt={`${label}${image.file ? '本地预览' : '当前图片'}`} className="h-28 max-w-full rounded-sm object-contain" /> : null}
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {image.file ? <><span className="min-w-0 break-all">{image.file.name}</span><button type="button" className={buttonClass} disabled={disabled || image.status === 'UPLOADING'} onClick={() => { onSelect(); setError(''); if (input.current) input.current.value = '' }}>取消选择</button></> : null}
      {!image.file && currentUrl ? <button type="button" className={buttonClass} disabled={disabled} onClick={() => { onRemove(); if (input.current) input.current.value = '' }}>移除当前图片</button> : null}
    </div>
    {image.status === 'UPLOADING' ? <p role="status" className="text-xs">正在上传…</p> : null}
    {image.status === 'UPLOADED' && (image.file || !currentUrl) ? <p role="status" className="text-xs">图片已上传</p> : null}
    {image.status === 'FAILED' ? <p role="alert" className="text-sm text-[var(--danger)]">上传失败：{image.error || '请重试'}</p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {image.file && image.status !== 'UPLOADED' ? <p className="text-xs text-[var(--foreground-muted)]">选择后只在本机预览；保存时通过现有活动图片接口上传，失败不会替换原图。</p> : null}
  </div>
}

export function TopicActivityWizard({ open, onClose, badgeOptions = [], onOpenEditor, onActivitySaved, mode = 'CREATE', activityId = null }: {
  open: boolean; onClose: () => void; badgeOptions?: readonly TopicWizardBadgeOption[]; onOpenEditor?: (activityId: string) => Promise<void> | void
  onActivitySaved?: (activityId: string) => Promise<void> | void
  mode?: 'CREATE' | 'EDIT'; activityId?: string | null
}) {
  const [draft, setDraft] = useState(createTopicWizardDraft)
  const draftRef = useRef(draft)
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [media, setMedia] = useState(createWizardMedia)
  const mediaRef = useRef(media)
  const [initialController] = useState(() => new WizardSaveSessionController(draft.identity.draftId, 'API'))
  const controller = useRef(initialController)
  const [saveSession, setSaveSession] = useState(() => initialController.getState())
  const [localSnapshot, setLocalSnapshot] = useState<{ snapshot: WizardSnapshot; session: WizardSaveSession } | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [confirmation, setConfirmation] = useState(false)
  const [programConfirmation, setProgramConfirmation] = useState(false)
  const [lotteryConfirmation, setLotteryConfirmation] = useState(false)
  const [publishConfirmation, setPublishConfirmation] = useState(false)
  const [openingEditor, setOpeningEditor] = useState(false)
  const [message, setMessage] = useState('')
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [editBaseline, setEditBaseline] = useState<TopicWizardEditBaseline | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editLoadError, setEditLoadError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editPending, setEditPending] = useState<EditPendingVerification | undefined>()
  const [editSavedStages, setEditSavedStages] = useState<string[]>([])
  const [editConfirmation, setEditConfirmation] = useState(false)
  const [mediaPreparing, setMediaPreparing] = useState(false)
  const [mediaStatus, setMediaStatus] = useState('')
  const [testImageUploading, setTestImageUploading] = useState(false)
  const testImageUploadLock = useRef(false)
  const [editReloadCounter, setEditReloadCounter] = useState(0)
  const operationLock = useRef(false)
  const isEdit = mode === 'EDIT' && Boolean(activityId)
  const [dirty, setDirty] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(true)
  const saveBusy = saveSession.requestLock !== null || editSaving || editLoading || mediaPreparing || testImageUploading
  const submitted = saveSession.activityId !== null || saveSession.stages.ACTIVITY === 'UNKNOWN'
  const programFrozen = saveSession.programSave.writeAttempted || ['SUCCEEDED', 'UNKNOWN'].includes(saveSession.stages.PROGRAM)
  const lotteryFrozen = saveSession.lotterySave.writeAttempted || ['SUCCEEDED', 'UNKNOWN'].includes(saveSession.stages.LOTTERY)
  const programConfirmed = saveSession.confirmedProgram !== null && saveSession.stages.PROGRAM === 'SUCCEEDED' && saveSession.programSave.readback === 'SUCCEEDED'
  const published = saveSession.confirmedPublish !== null && saveSession.publishSave.readback === 'SUCCEEDED'
  const publishLocked = saveSession.publishSave.writeAttempted || published
  const canPublish = programConfirmed && Boolean(saveSession.createdActivity && saveSession.activityId)
    && (!draft.lottery.enabled || Boolean(saveSession.confirmedLottery && saveSession.lotterySave.readback === 'SUCCEEDED'))
  useEffect(() => {
    if (!open || !isEdit || !activityId) return
    let active = true
    setEditLoading(true); setEditLoadError(''); setEditBaseline(null); setEditPending(undefined); setEditSavedStages([]); setErrors([]); setMessage('')
    const read = async (path: string) => {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || `读取失败（${response.status}）`)
      return data
    }
    void Promise.all([
      read(`/api/admin/activities/${encodeURIComponent(activityId)}`),
      read(`/api/admin/activities/${encodeURIComponent(activityId)}/v2`),
      read(`/api/admin/activities/${encodeURIComponent(activityId)}/v2/lottery`),
    ]).then(([activityData, programData, lotteryData]) => {
      if (!active) return
      const initial = topicWizardEditInitialState(activityData, programData, lotteryData, activityId)
      draftRef.current = initial.draft; mediaRef.current = initial.media
      setDraft(initial.draft); setMedia(initial.media); setEditBaseline(initial.baseline); setStep(0); setDirty(false)
    }).catch((cause) => {
      if (active) setEditLoadError(cause instanceof Error ? cause.message : '活动配置读取失败；未执行任何保存。')
    }).finally(() => { if (active) setEditLoading(false) })
    return () => { active = false }
  }, [open, isEdit, activityId, editReloadCounter])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; const token = controller.current.getState().requestLock; if (token) controller.current.finish(token) }
  }, [])
  useEffect(() => { if (open) titleRef.current?.focus() }, [open, step])
  useEffect(() => {
    if (!saveBusy && !submitted) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveBusy, submitted])
  function update(change: (current: TopicActivityWizardDraft) => TopicActivityWizardDraft) {
    const state = controller.current.getState()
    if (state.requestLock || state.publishSave.writeAttempted || state.confirmedPublish || state.stages.ACTIVITY === 'UNKNOWN') return
    // Read form events now, before React restores a controlled input's value.
    const nextDraft = change(draftRef.current)
    if (submitted && JSON.stringify(nextDraft.activity) !== JSON.stringify(draftRef.current.activity)) return
    if (programFrozen && JSON.stringify(nextDraft.program) !== JSON.stringify(draftRef.current.program)) return
    if (lotteryFrozen && JSON.stringify(nextDraft.lottery) !== JSON.stringify(draftRef.current.lottery)) return
    draftRef.current = nextDraft
    setDraft(nextDraft); setDirty(true); setErrors([]); setMessage('')
  }
  function updateMedia(change: (current: WizardMedia) => WizardMedia) {
    const state = controller.current.getState()
    if (state.requestLock || state.publishSave.writeAttempted || state.confirmedPublish || lotteryFrozen) return
    const nextMedia = change(mediaRef.current)
    if (submitted && nextMedia.cover !== mediaRef.current.cover) return
    mediaRef.current = nextMedia
    setMedia(nextMedia); setDirty(true); setErrors([]); setMessage('')
  }
  function commitMedia(next: WizardMedia) { mediaRef.current = next; setMedia(next) }
  function commitDraft(next: TopicActivityWizardDraft) { draftRef.current = next; setDraft(next) }
  function testImageUploadChanged(uploading: boolean) {
    testImageUploadLock.current = uploading
    setTestImageUploading(uploading)
  }
  async function uploadImage(target: 'cover' | 'prize', prizeId?: string) {
    const image = target === 'cover' ? mediaRef.current.cover : prizeId ? mediaRef.current.prizes[prizeId] : undefined
    if (!image || image.status === 'EMPTY' || image.status === 'UPLOADED') return
    if (image.status === 'NEEDS_RESELECT' || !image.file) {
      if (target === 'cover') return // Cover is optional; an un-restorable local preview is never submitted.
      throw new Error(`奖品图片需重新选择后才能保存。`)
    }
    const started = beginWizardImageUpload(image)
    const apply = (next: WizardImage) => {
      if (target === 'cover') commitMedia({ ...mediaRef.current, cover: next })
      else commitMedia({ ...mediaRef.current, prizes: { ...mediaRef.current.prizes, [prizeId!]: next } })
    }
    apply(started); setMediaStatus(`${target === 'cover' ? '活动封面' : '奖品图片'}上传中…`)
    try {
      const uploadedUrl = await uploadActivityImage(image.file)
      const storedUrl = storedActivityImageUrl(uploadedUrl)
      if (!storedUrl) throw new Error('图片接口返回的地址无法用于活动配置；原有图片保持不变。')
      const settled = settleWizardImageUpload(started, started.selectionId!, started.uploadRequestId!, { url: storedUrl })
      apply(settled)
      if (target === 'cover') commitDraft({ ...draftRef.current, activity: { ...draftRef.current.activity, coverUrl: storedUrl } })
      else {
        const publicPath = `/cos${new URL(storedUrl).pathname}`
        commitDraft({ ...draftRef.current, lottery: { ...draftRef.current.lottery, prizes: draftRef.current.lottery.prizes.map((prize) => prize.id === prizeId ? { ...prize, imageUrl: publicPath } : prize) } })
      }
      setMediaStatus('图片已上传；只有本次活动保存回读成功后，才会替换原图片。')
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : '图片上传失败'
      apply(settleWizardImageUpload(started, started.selectionId!, started.uploadRequestId!, { error }))
      throw new Error(error)
    }
  }
  async function prepareSelectedImages(includeCover: boolean, includePrizes: boolean) {
    if (operationLock.current) throw new Error('保存正在处理，请稍候。')
    operationLock.current = true; setMediaPreparing(true); setMediaStatus('')
    try {
      if (includeCover) await uploadImage('cover')
      if (includePrizes) {
        const ids = draftRef.current.lottery.prizes.map((prize) => prize.id)
        for (const id of ids) await uploadImage('prize', id)
      }
    } finally { setMediaPreparing(false) }
  }
  function finishOperation() { operationLock.current = false; setMediaPreparing(false); setEditSaving(false) }
  function captureLocalSnapshot() {
    setLocalSnapshot({ snapshot: createWizardSnapshot(draftRef.current, mediaRef.current, step), session: controller.current.getCheckpoint() })
    setMessage('本地快照已保留在当前页面；未保存到服务器。快照不包含本地图片文件。')
  }
  function restoreLocalSnapshot() {
    if (controller.current.getState().activityId || controller.current.getState().stages.ACTIVITY === 'UNKNOWN') return
    if (!localSnapshot || controller.current.getState().requestLock) return
    const restored = restoreWizardSnapshot(localSnapshot.snapshot)
    draftRef.current = restored.draft; mediaRef.current = restored.media
    setDraft(restored.draft); setMedia(restored.media); setStep(restored.step)
    controller.current = WizardSaveSessionController.restore(localSnapshot.session)
    setSaveSession(controller.current.getState()); setRestoreConfirm(false); setErrors([])
    setMessage('本地快照已恢复。未上传的图片需重新选择；未进行任何服务器操作。')
  }
  async function saveDraft() {
    if (!confirmation || controller.current.getState().requestLock || operationLock.current || testImageUploadLock.current) return
    setMessage(''); setErrors([])
    try {
      await prepareSelectedImages(!saveSession.activityId, false)
      const snapshot = createWizardSnapshot(draftRef.current, mediaRef.current, step)
      const result = await saveWizardActivityDraft(controller.current, snapshot, { onChange: (state) => { if (mounted.current) setSaveSession(state) } })
      if (mounted.current) setMessage(result === 'CONFIRMED'
        ? '活动草稿已创建并回读确认。可继续保存话题 V2 配置。活动未发布，抽奖未保存。'
        : result === 'BLOCKED' ? '请求中或创建结果不明，已阻止重复提交。请核对保存会话。' : '保存流程已停止，输入及已有活动 ID 保留。请查看失败阶段。')
    } catch (cause) {
      if (mounted.current) setErrors([cause instanceof Error ? cause.message : '草稿配置无法提交'])
    } finally {
      finishOperation()
      if (mounted.current) { setSaveSession(controller.current.getState()); setConfirmation(false) }
    }
  }
  async function saveProgram() {
    if (!programConfirmation || controller.current.getState().requestLock || operationLock.current || testImageUploadLock.current) return
    operationLock.current = true; setEditSaving(true)
    setErrors([]); setMessage('')
    try {
      const result = await saveWizardProgram(controller.current, createWizardSnapshot(draftRef.current, mediaRef.current, step), {
        onChange: (state) => { if (mounted.current) setSaveSession(state) },
      })
      if (mounted.current) setMessage(result === 'CONFIRMED' ? '话题 V2 配置已回读确认，可继续保存抽奖配置。活动仍为草稿；不上传、不发布、不开奖。'
        : result === 'BLOCKED' ? '缺少本向导创建且已核验的活动 ID，或请求正在处理，不能保存 V2。'
          : 'V2 流程已停止，活动 ID 和配置输入保留；请查看失败阶段。')
    } catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : 'V2 配置无法提交']) }
    finally { finishOperation(); if (mounted.current) { setSaveSession(controller.current.getState()); setProgramConfirmation(false) } }
  }
  function requestProgram() {
    const state = controller.current.getState()
    if (testImageUploadLock.current || state.requestLock || !state.activityId || state.stages.ACTIVITY !== 'SUCCEEDED' || state.stages.READBACK !== 'SUCCEEDED') return
    try {
      prepareWizardProgramPayload(programFrozen ? state.programSave.snapshot! : createWizardSnapshot(draftRef.current, mediaRef.current, step))
      setErrors([]); setProgramConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查 V2 配置']) }
  }
  async function saveLottery() {
    if (!lotteryConfirmation || controller.current.getState().requestLock || operationLock.current || testImageUploadLock.current) return
    setErrors([]); setMessage('')
    try {
      if (draftRef.current.lottery.enabled) await prepareSelectedImages(false, true)
      const result = await saveWizardLottery(controller.current, createWizardSnapshot(draftRef.current, mediaRef.current, step), {
        onChange: (state) => { if (mounted.current) setSaveSession(state) },
      })
      if (mounted.current) setMessage(result === 'CONFIRMED' ? '抽奖配置已保存并回读确认。活动仍为草稿；未发布、未开奖，未发放奖励。'
        : result === 'SKIPPED' ? '抽奖开关关闭，已跳过配置保存；未请求抽奖接口，不会关闭已有配置。'
          : result === 'BLOCKED' ? '缺少本向导活动或 V2 成功回执，或请求正在处理，不能保存抽奖。'
            : '抽奖配置流程已停止。输入、活动 ID 和阶段状态保留；已发送请求后仅允许回读核对。')
    } catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : '抽奖配置无法提交']) }
    finally { finishOperation(); if (mounted.current) { setSaveSession(controller.current.getState()); setLotteryConfirmation(false) } }
  }
  function requestLottery() {
    const state = controller.current.getState()
    if (testImageUploadLock.current || state.requestLock || !programConfirmed || !state.activityId) return
    try {
      if (!draft.lottery.enabled) { setErrors([]); setLotteryConfirmation(true); return }
      prepareWizardProgramPayload(createWizardSnapshot(draftRef.current, mediaRef.current, step))
      const problems = topicWizardErrors(draft, 3)
      if (problems.length) throw new Error(problems.join('；'))
      setErrors([]); setLotteryConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查抽奖配置']) }
  }
  async function publish() {
    if (!publishConfirmation || controller.current.getState().requestLock || operationLock.current || testImageUploadLock.current) return
    operationLock.current = true; setEditSaving(true)
    setErrors([]); setMessage('')
    try {
      const result = await publishWizardActivity(controller.current, createWizardSnapshot(draftRef.current, mediaRef.current, step), {
        onChange: (state) => { if (mounted.current) setSaveSession(state) },
      })
      if (mounted.current) setMessage(result === 'CONFIRMED' ? '活动已发布，GET 回读确认 PUBLISHED。向导保存已锁定，请进入现有编辑页继续管理。'
        : result === 'BLOCKED' ? '缺少本向导保存成功回执、请求处理中或已发布，已阻止重复发布。'
          : '发布流程已停止。已有状态和活动 ID 保留；发布请求发出后仅允许 GET 核验，不重复 PATCH。')
    } catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : '发布校验失败']) }
    finally { finishOperation(); if (mounted.current) { setSaveSession(controller.current.getState()); setPublishConfirmation(false) } }
  }
  function requestPublish() {
    const state = controller.current.getState()
    if (testImageUploadLock.current || state.requestLock || state.confirmedPublish || !canPublish) return
    try {
      prepareWizardPublishGate(state.publishSave.writeAttempted ? state.publishSave.snapshot! : createWizardSnapshot(draftRef.current, mediaRef.current, step), state)
      setErrors([]); setPublishConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查发布配置']) }
  }
  function requestEditSave() {
    if (!editBaseline || !activityId || editLoading || editSaving || operationLock.current || testImageUploadLock.current) return
    if (editPending) { setEditConfirmation(true); return }
    try {
      const changes = getTopicWizardEditChanges(editBaseline, draftRef.current, mediaRef.current)
      if (!Object.keys(changes.activityPatch).length && !changes.programChanged && !changes.lotteryChanged) {
        setMessage('没有需要保存的修改。'); setErrors([]); return
      }
      setErrors([]); setEditConfirmation(true)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '请检查修改内容'
      // A selected image is uploaded only after the admin confirms the save.
      if (/图片尚未上传完成/.test(message)) { setErrors([]); setEditConfirmation(true); return }
      setErrors([message])
    }
  }
  async function saveEdits() {
    if (!editConfirmation || !editBaseline || !activityId || operationLock.current || editSaving || testImageUploadLock.current) return
    setErrors([]); setMessage(''); setEditSaving(true)
    try {
      await prepareSelectedImages(true, true)
      const result = await saveTopicWizardEdits({ activityId, baseline: editBaseline, draft: draftRef.current, media: mediaRef.current, pendingVerification: editPending })
      setEditBaseline(result.baseline); setEditPending(result.pendingVerification)
      if (result.completed.length) setEditSavedStages((current) => [...new Set([...current, ...result.completed])])
      let listUpdateWarning = ''
      if (result.completed.length && onActivitySaved) {
        try { await onActivitySaved(activityId) }
        catch { listUpdateWarning = ' 活动已保存，但活动列表更新失败；返回后可刷新列表。' }
      }
      setMessage(result.message + listUpdateWarning)
      if (result.status === 'SAVED' || result.status === 'NO_CHANGES') setDirty(false)
      else if (result.status === 'PARTIAL') setDirty(true)
      if (result.status === 'UNKNOWN') setErrors(['上次写入结果不明；只允许点击“核对保存结果”读取服务器，不能重复提交。'])
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '保存修改失败；已保留页面输入。']) }
    finally { finishOperation(); setEditConfirmation(false) }
  }
  function reloadEdit() {
    if (editSaving || operationLock.current) return
    setEditPending(undefined); setEditSavedStages([]); setEditReloadCounter((value) => value + 1)
  }
  async function openEditor() {
    const state = controller.current.getState()
    if (!state.confirmedPublish || !state.activityId || !onOpenEditor || openingEditor) return
    setOpeningEditor(true); setErrors([])
    try { await onOpenEditor(state.activityId) }
    catch { if (mounted.current) setErrors(['编辑页加载失败；发布状态保留，请重试进入编辑页。']) }
    finally { if (mounted.current) setOpeningEditor(false) }
  }
  function activity(value: Partial<TopicActivityWizardDraft['activity']>) {
    update((current) => ({ ...current, activity: { ...current.activity, ...value } }))
  }
  function lottery(value: Partial<TopicActivityWizardDraft['lottery']>) {
    update((current) => ({ ...current, lottery: { ...current.lottery, ...value } }))
  }
  function requestDraft() {
    if (testImageUploadLock.current || controller.current.getState().requestLock || operationLock.current || (saveSession.stages.ACTIVITY === 'UNKNOWN' && !saveSession.activityId)) return
    try {
      prepareWizardActivityPayload(saveSession.activityId ? saveSession.snapshot! : createWizardSnapshot(draftRef.current, mediaRef.current, step))
      setErrors([]); setConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查活动配置']) }
  }
  function next() {
    if (testImageUploadLock.current) return
    if (isEdit && editBaseline) {
      try { getTopicWizardEditChanges(editBaseline, draftRef.current, mediaRef.current) }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : '请检查修改内容'
        // Selected cover/prize files are uploaded only after save confirmation.
        if (!/图片尚未上传完成/.test(message)) { setErrors([message]); return }
      }
      setErrors([]); setStep((current) => Math.min(4, current + 1)); return
    }
    const problems = topicWizardErrors(draft, step)
    setErrors(problems)
    if (!problems.length) setStep((current) => Math.min(4, current + 1))
  }
  if (!open) return null
  return <section aria-label={isEdit ? '话题活动编辑向导' : '话题活动创建向导'} className="min-w-0 space-y-5 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
    <ConfirmDialog open={confirmation} title={saveSession.activityId ? '重新回读活动草稿？' : '创建话题活动草稿？'}
      description="本阶段仅创建 TOPIC_ACTIVITY 草稿并回读；不保存 V2、奖励或抽奖配置，不发布。已选择封面时会先通过现有图片接口上传，上传失败不会创建活动。已取得活动 ID 后只回读，不重复创建。"
      confirmLabel={saveSession.activityId ? '确认回读' : '确认创建草稿'} loading={saveBusy} onCancel={() => { if (!saveBusy) setConfirmation(false) }} onConfirm={() => void saveDraft()} />
    <ConfirmDialog open={programConfirmation} title={programFrozen ? '回读核对 V2 配置？' : '保存话题 V2 配置？'}
      description="仅保存本向导创建的草稿的 program 配置。保存前核验现有配置，保存后回读。不会保存抽奖，不上传、不发布、不开奖；结果不明时只回读，不重复发送。"
      confirmLabel={programFrozen ? '确认核对 V2' : '确认保存 V2'} loading={saveBusy} onCancel={() => { if (!saveBusy) setProgramConfirmation(false) }} onConfirm={() => void saveProgram()} />
    <ConfirmDialog open={lotteryConfirmation} title={lotteryFrozen ? '回读核对抽奖配置？' : draft.lottery.enabled ? '保存抽奖配置？' : '跳过抽奖配置？'}
      description="仅保存本向导草稿的 lottery config。依赖 V2 成功回执，保存前核验、保存后回读。不上传、不发布、不开奖、不发放奖励；已发送请求后只允许回读，不重复 PATCH。关闭开关时仅跳过，不会关闭已有配置。"
      confirmLabel={lotteryFrozen ? '确认核对抽奖' : draft.lottery.enabled ? '确认保存抽奖配置' : '确认跳过抽奖'} loading={saveBusy} onCancel={() => { if (!saveBusy) setLotteryConfirmation(false) }} onConfirm={() => void saveLottery()} />
    <ConfirmDialog open={publishConfirmation} title={publishLocked ? '核验发布状态？' : '确认发布话题活动？'}
      description={publishLocked ? '原发布请求已发送，本次仅 GET 核验，不重复 PATCH。' : '将重新核验活动、V2、抽奖资格来源、奖池及实物收件加密配置，然后发布本向导活动。不会调用开奖、中奖或发货接口。'}
      confirmLabel={publishLocked ? '确认核验发布' : '确认发布活动'} loading={saveBusy} onCancel={() => { if (!saveBusy) setPublishConfirmation(false) }} onConfirm={() => void publish()} />
    <ConfirmDialog open={restoreConfirm} title="恢复本地快照？" description="将替换当前页面输入。快照不会保存本地预览图片；恢复后可重新选择，也可不设置封面。不会写入服务器。"
      confirmLabel="确认恢复快照" onCancel={() => setRestoreConfirm(false)} onConfirm={restoreLocalSnapshot} />
    <ConfirmDialog open={closeConfirm} title="收起向导？" description="输入会暂留在当前页面，重新打开可继续；刷新或离开页面后会丢失。"
      confirmLabel="收起并保留本地输入" onCancel={() => setCloseConfirm(false)} onConfirm={() => { setCloseConfirm(false); onClose() }} />
    <ConfirmDialog open={editConfirmation} title={editPending ? '核对上次保存结果？' : '保存活动修改？'}
      description={editPending ? '上次请求结果不确定。本次只重新读取服务器，不会再次提交写入。' : '仅提交实际修改的活动信息、参与规则、测试题或抽奖模块；保存前会检查服务器是否被其他管理员改动，保存后会逐项回读。多个模块不是一个原子事务，发生部分成功会明确显示。不会重新创建活动、改变发布状态或重发奖励。'}
      confirmLabel={editPending ? '核对保存结果' : '确认保存修改'} loading={saveBusy} onCancel={() => { if (!saveBusy) setEditConfirmation(false) }} onConfirm={() => void saveEdits()} />
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 ref={titleRef} tabIndex={-1} className="text-xl font-bold outline-none">{isEdit ? '编辑话题活动' : '创建话题活动'} · {steps[step]}</h2>
        <p className="mt-2 text-sm text-[var(--foreground-muted)]">抽奖是话题活动的可选扩展，不是独立活动类型。</p></div>
      <button type="button" className={buttonClass} disabled={saveBusy} onClick={() => dirty ? setCloseConfirm(true) : onClose()}>{isEdit ? '返回活动管理' : '收起向导'}</button>
    </header>
    {!isEdit ? <><p role="note" className="border border-[var(--border)] p-3 text-sm">按步骤填写活动信息、参与规则、可选测试和奖励；最后保存草稿或发布。抽奖将在活动保存后配置，不会自动开奖。</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={saveBusy || publishLocked} onClick={captureLocalSnapshot}>保留本地快照</button><button type="button" className={buttonClass} disabled={saveBusy || publishLocked || submitted || !localSnapshot} onClick={() => setRestoreConfirm(true)}>恢复本地快照</button></div></> : null}
    {editLoading ? <p role="status" className="border border-[var(--border)] p-3 text-sm">正在读取现有活动配置…</p> : null}
    {editLoadError ? <div role="alert" className="space-y-3 border border-red-400 p-3 text-sm"><p>活动配置读取失败，未执行任何保存：{editLoadError}</p><button type="button" className={buttonClass} onClick={reloadEdit}>重新读取</button></div> : null}
    {isEdit && editBaseline ? <p className="border border-[var(--border)] p-3 text-sm">当前状态：{editBaseline.activity.status === 'PUBLISHED' ? '已发布' : editBaseline.activity.status === 'DRAFT' ? '草稿' : '已取消'}。此处只保存修改，不重新创建活动，也不改变发布状态。</p> : null}
    <fieldset disabled={saveBusy || publishLocked || editLoading || Boolean(editLoadError) || (isEdit && (editBaseline?.activity.status === 'CANCELLED' || Boolean(editPending))) || (!isEdit && ((programFrozen && step === 1) || (lotteryFrozen && step === 3) || (submitted && step === 0)))} className="min-w-0 space-y-5">
    <ol aria-label="配置步骤" className="grid grid-cols-1 gap-2 sm:grid-cols-5">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}
      className={`rounded-sm border p-3 text-sm ${step === index ? 'border-[var(--primary)] font-bold' : 'border-[var(--border)] text-[var(--foreground-muted)]'}`}>{index + 1}. {label}</li>)}</ol>

    {step === 0 ? <div className="space-y-4">
      <Field label="活动名称"><input className={inputClass} autoComplete="off" maxLength={160} value={draft.activity.title} onChange={(event) => activity({ title: event.target.value })} placeholder="例如：天使的礼物" /></Field>
      <WizardImageField label="活动封面" image={media.cover} currentUrl={draft.activity.coverUrl} disabled={saveBusy} onSelect={(file) => {
        if (file) updateMedia((current) => ({ ...current, cover: selectWizardImage(file) }))
        else updateMedia((current) => ({ ...current, cover: draft.activity.coverUrl ? { ...current.cover, file: null, status: 'UPLOADED', url: draft.activity.coverUrl, selectionId: null, uploadRequestId: null, error: null } : createWizardMedia().cover }))
      }} onRemove={() => { activity({ coverUrl: null }); updateMedia((current) => ({ ...current, cover: createWizardMedia().cover })) }} />
      <p role="note" className="text-xs text-[var(--foreground-muted)]">{media.cover.status === 'UPLOADED'
        ? '活动封面已上传。'
        : media.cover.file
          ? '已选择本地图片（仅预览，尚未上传）。'
          : media.cover.status === 'NEEDS_RESELECT'
            ? '快照中的本地封面需重新选择；此项可留空。'
            : media.cover.status === 'UPLOADING'
              ? '活动封面正在上传。'
              : '未选择封面（可选）。'}</p>
      <Field label="活动介绍"><textarea className={inputClass} rows={4} maxLength={20000} value={draft.activity.description} onChange={(event) => activity({ description: event.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="活动开始（北京时间）"><input className={inputClass} type="datetime-local" value={draft.activity.startsAt || ''} onChange={(event) => activity({ startsAt: event.target.value || null })} /></Field>
        <Field label="活动结束（北京时间）"><input className={inputClass} type="datetime-local" value={draft.activity.endsAt || ''} onChange={(event) => isEdit ? activity({ endsAt: event.target.value || null }) : update((current) => changeTopicWizardEnd(current, event.target.value))} /></Field>
      </div><p className="text-xs text-[var(--foreground-muted)]">活动时间控制参与周期。平台任务复用此时间；开启抽奖时，资格截止默认同活动结束，不重复填写。</p>
    </div> : null}

    {step === 1 ? <div className="space-y-4">
      <Field label="用户如何参与话题活动"><textarea disabled={submitted} className={inputClass} rows={3} maxLength={2000} value={draft.activity.participationRule || ''} onChange={(event) => activity({ participationRule: event.target.value })} placeholder="例如：发布活动相关内容，在活动主帖提交分享截图，等待管理员审核。" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked disabled />参与评论需要管理员审核（现有规则，不可关闭）</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={submitted} checked={draft.activity.allowImageAttachments} onChange={(event) => activity({ allowImageAttachments: event.target.checked })} />允许图片附件</label>
      <fieldset className="space-y-3 border border-[var(--border)] p-3"><legend className="px-1 font-bold">外部平台任务（可选）</legend>
        <p className="text-xs text-[var(--foreground-muted)]">普通话题可不选平台；开启抽奖必须有有效的平台截图任务。允许多次评论，拒绝后可重新提交。</p>
        <div className="flex flex-wrap gap-4">{topicWizardPlatforms.map((platform) => <label key={platform.key} className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.program.entries.some((entry) => entry.platformKey === platform.key && entry.enabled)} onChange={() => update((current) => toggleTopicWizardPlatform(current, platform.key))} />{platform.name}</label>)}</div>
        {draft.program.entries.filter((entry) => entry.enabled).map((entry) => <div key={entry.id} className="space-y-3 border-t border-[var(--border)] pt-3">
          <Field label={`${entry.platformName}任务标题`}><input className={inputClass} maxLength={512} value={entry.title} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item) } }))} /></Field>
          <Field label={`${entry.platformName}任务要求`}><textarea className={inputClass} rows={2} maxLength={8000} value={entry.instructions} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, instructions: event.target.value } : item) } }))} /></Field>
          <Field label={`${entry.platformName}素材要求`}><textarea className={inputClass} rows={2} maxLength={2000} value={entry.materialRequirement} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, materialRequirement: event.target.value } : item) } }))} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">{(['minImages', 'maxImages'] as const).map((key) => <Field key={key} label={`${entry.platformName}${key === 'minImages' ? '最少' : '最多'}截图数`}><input className={inputClass} type="number" min={1} max={20} value={entry[key]} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, [key]: Number(event.target.value) } : item) } }))} /></Field>)}</div>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={entry.allowResubmit} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, allowResubmit: event.target.checked } : item) } }))} />审核拒绝后允许重新提交</label>
        </div>)}
        <div className="grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.program.platformRewards.allowStacking} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, platformRewards: { ...current.program.platformRewards, allowStacking: event.target.checked } } }))} />允许多个平台奖励累计</label>
          <Field label="每人最多完成平台任务数（留空不限）"><input className={inputClass} type="number" min={1} max={100} value={draft.program.platformRewards.maxEntries ?? ''} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, platformRewards: { ...current.program.platformRewards, maxEntries: event.target.value === '' ? null : Number(event.target.value) } } }))} /></Field>
          <Field label="每人最多参与平台数（留空不限）"><input className={inputClass} type="number" min={1} max={100} value={draft.program.platformRewards.maxPlatforms ?? ''} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, platformRewards: { ...current.program.platformRewards, maxPlatforms: event.target.value === '' ? null : Number(event.target.value) } } }))} /></Field>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">审核由管理员按现有流程完成。当前服务端没有独立的点赞数量字段，相关要求可写在任务说明中。</p>
      </fieldset>
    </div> : null}

    {step === 2 ? <TopicActivityWizardTestEditor value={draft.program.test} disabled={saveBusy || (!isEdit && programFrozen)} onUploadingChange={testImageUploadChanged} requiresVersionBump={isEdit && (editBaseline?.testParticipants || 0) > 0} onChange={(test) => update((current) => ({ ...current, program: { ...current.program, enabled: current.program.enabled || test.enabled || current.program.entries.some((entry) => entry.enabled) || current.program.fixedReward.enabled || current.program.medal.enabled || current.program.poll.enabled, test } }))} /> : null}

    {step === 3 ? <div className="space-y-5">
      <fieldset disabled={programFrozen} className="space-y-3 border border-[var(--border)] p-3"><legend className="px-1 font-bold">A. 参与奖励</legend>
        <p className="text-xs">平台任务审核通过后按入口独立发放挂号费，现有规则要求每入口至少 1；不会增加抽奖次数。</p>
        {draft.program.entries.filter((entry) => entry.enabled).map((entry) => <Field key={entry.id} label={`${entry.platformName}挂号费奖励`}><input className={inputClass} type="number" min={1} max={2000000000} value={entry.points} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, points: Number(event.target.value) } : item) } }))} /></Field>)}
        {!draft.program.entries.some((entry) => entry.enabled) ? <p className="text-sm">未选择平台任务，本阶段不配置平台挂号费奖励。</p> : null}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.program.medal.enabled} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, medal: { ...current.program.medal, enabled: event.target.checked, triggers: [current.program.entries.some((entry) => entry.enabled) ? 'PLATFORM' : 'APPROVED_COMMENT'] } } }))} />启用参与勋章</label>
        {draft.program.medal.enabled ? <><Field label="参与奖励勋章"><select className={inputClass} value={draft.program.medal.badgeId || ''} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, medal: { ...current.program.medal, badgeId: event.target.value || null } } }))}>
          <option value="">请选择勋章</option>{badgeOptions.map((badge) => <option key={badge.id} value={badge.id}>{badge.name}</option>)}</select></Field>
          {!badgeOptions.length ? <p role="note" className="text-xs">当前没有可用勋章选项；关闭参与勋章即可继续保存。</p> : null}</> : null}
      </fieldset>
      <fieldset disabled={isEdit ? editBaseline?.lotteryMeta.configLocked : lotteryFrozen} className="space-y-4 border border-[var(--border)] p-3"><legend className="px-1 font-bold">B. 话题活动扩展：抽奖</legend>
        {isEdit && editBaseline?.lotteryMeta.configLocked ? <p role="note" className="text-sm">此抽奖已有参与或开奖记录，现有规则已锁定配置；奖品、资格和开奖条件不可在此修改。</p> : null}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.lottery.enabled} onChange={(event) => lottery({ enabled: event.target.checked })} />开启本话题活动抽奖</label>
        {draft.lottery.enabled ? <>
          <p className="text-sm">完成本活动指定平台任务、提交有效截图并审核通过后，获得一次抽奖资格。多个平台不增加次数。</p>
          <p className="text-xs text-[var(--foreground-muted)]">普通讨论评论不是当前资格来源；资格截止复用活动结束时间。</p>
          <fieldset className="space-y-2"><legend className="font-bold">抽奖资格来源</legend>{draft.program.entries.filter((entry) => entry.enabled).map((entry) => <label key={entry.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.lottery.sourceEntryIds.includes(entry.id)} onChange={(event) => lottery({ sourceEntryIds: event.target.checked ? [...draft.lottery.sourceEntryIds, entry.id] : draft.lottery.sourceEntryIds.filter((id) => id !== entry.id) })} />{entry.platformName}截图任务审核通过</label>)}
          {!draft.program.entries.some((entry) => entry.enabled) ? <p role="note" className="text-sm text-[var(--danger)]">请返回参与规则，配置平台截图任务。</p> : null}</fieldset>
          <div className="space-y-4">{draft.lottery.prizes.map((prize, index) => <section key={prize.id} className="space-y-3 border border-[var(--border)] p-3" aria-label={`奖品 ${index + 1}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">奖品 {index + 1}</h4><div className="flex gap-2"><button type="button" className={buttonClass} disabled={index === 0} onClick={() => lottery({ prizes: moveItem(draft.lottery.prizes, index, -1).map((item, sortOrder) => ({ ...item, sortOrder })) })}>上移</button><button type="button" className={buttonClass} disabled={index === draft.lottery.prizes.length - 1} onClick={() => lottery({ prizes: moveItem(draft.lottery.prizes, index, 1).map((item, sortOrder) => ({ ...item, sortOrder })) })}>下移</button><button type="button" className={buttonClass} onClick={() => { lottery({ prizes: draft.lottery.prizes.filter((item) => item.id !== prize.id).map((item, sortOrder) => ({ ...item, sortOrder })) }); updateMedia((current) => { const prizes = { ...current.prizes }; delete prizes[prize.id]; return { ...current, prizes } }) }}>移除奖品 {index + 1}</button></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label={`奖品 ${index + 1}名称`}><input className={inputClass} maxLength={200} value={prize.name} onChange={(event) => lottery({ prizes: draft.lottery.prizes.map((item) => item.id === prize.id ? { ...item, name: event.target.value } : item) })} /></Field>
            <Field label={`奖品 ${index + 1}数量`}><input className={inputClass} type="number" min={1} max={1000} value={prize.quantity} onChange={(event) => lottery({ prizes: draft.lottery.prizes.map((item) => item.id === prize.id ? { ...item, quantity: Number(event.target.value) } : item) })} /></Field></div>
            <Field label={`奖品 ${index + 1}说明`}><textarea className={inputClass} rows={2} maxLength={2000} value={prize.description} onChange={(event) => lottery({ prizes: draft.lottery.prizes.map((item) => item.id === prize.id ? { ...item, description: event.target.value } : item) })} /></Field>
            <WizardImageField label={`奖品 ${index + 1}图片`} image={media.prizes[prize.id] || createWizardMedia().cover} currentUrl={prize.imageUrl} disabled={saveBusy} onSelect={(file) => updateMedia((current) => ({ ...current, prizes: { ...current.prizes, [prize.id]: file ? selectWizardImage(file) : prize.imageUrl ? { ...current.prizes[prize.id], file: null, status: 'UPLOADED', url: prize.imageUrl, selectionId: null, uploadRequestId: null, error: null } : createWizardMedia().cover } }))} onRemove={() => { lottery({ prizes: draft.lottery.prizes.map((item) => item.id === prize.id ? { ...item, imageUrl: null } : item) }); updateMedia((current) => ({ ...current, prizes: { ...current.prizes, [prize.id]: createWizardMedia().cover } })) }} />
            {media.prizes[prize.id]?.status === 'NEEDS_RESELECT' ? <p className="text-sm">奖品图片文件未保存在快照中，请重新选择。</p> : null}
          </section>)}</div>
          <button type="button" className={buttonClass} onClick={() => lottery({ prizes: [...draft.lottery.prizes, { id: createWizardId('prize'), name: '', description: '', imageUrl: null, quantity: 1, sortOrder: draft.lottery.prizes.length }] })}>添加奖品</button>
          <div className="grid gap-4 sm:grid-cols-2">{isEdit ? <Field label="抽奖资格截止（北京时间）"><input className={inputClass} type="datetime-local" value={draft.lottery.eligibilityDeadline ? dateInputForWizard(draft.lottery.eligibilityDeadline) : ''} onChange={(event) => lottery({ eligibilityDeadline: event.target.value || null })} /></Field> : null}<Field label="开奖时间（北京时间）"><input className={inputClass} type="datetime-local" value={draft.lottery.drawAt ? dateInputForWizard(draft.lottery.drawAt) : ''} onChange={(event) => lottery({ drawAt: event.target.value || null })} /></Field>
          <Field label="开奖方式"><select className={inputClass} value={draft.lottery.mode} onChange={(event) => lottery({ mode: event.target.value as 'AUTO' | 'MANUAL' })}><option value="MANUAL">管理员确认开奖</option><option value="AUTO">到时自动开奖</option></select></Field>
          <Field label="收件截止（北京时间）"><input className={inputClass} type="datetime-local" value={draft.lottery.addressDeadline ? dateInputForWizard(draft.lottery.addressDeadline) : ''} onChange={(event) => lottery({ addressDeadline: event.target.value || null })} /></Field></div>
          <p className="text-xs text-[var(--foreground-muted)]">启用配置仍须通过现有服务端加密与规则门禁。本阶段只保存配置，不处理收件、发货或开奖。</p>
        </> : null}
      </fieldset>
      <p className="text-xs text-[var(--foreground-muted)]">结果海报和表单设计器高级字段仍可在「高级设置」中管理。</p>
    </div> : null}

    {step === 4 ? <><TopicActivityWizardSummary draft={draft} coverName={media.cover.fileInfo?.name} badgeName={badgeOptions.find((badge) => badge.id === draft.program.medal.badgeId)?.name} />
      <p className="text-sm">先保存活动与 V2；开启抽奖时须保存抽奖配置，最后完整核验并确认发布。发布不等于立即开奖。</p></> : null}
    </fieldset>
    {isEdit && editBaseline && editBaseline.activity.status !== 'CANCELLED' ? <div className="flex flex-wrap gap-3">
      <button type="button" className={buttonClass} disabled={saveBusy || !editBaseline} onClick={requestEditSave}>{editPending ? '核对保存结果' : '保存修改'}</button>
      <button type="button" className={buttonClass} disabled={saveBusy} onClick={() => dirty ? setCloseConfirm(true) : onClose()}>返回活动管理</button>
    </div> : null}
    {!isEdit && step === 4 ? <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={saveBusy || publishLocked || saveSession.programSave.writeAttempted || (!saveSession.activityId && saveSession.stages.ACTIVITY === 'UNKNOWN')} onClick={requestDraft}>{saveSession.activityId ? '重新回读草稿' : '创建话题活动草稿'}</button>
      <button type="button" className={buttonClass} disabled={saveBusy || publishLocked || lotteryFrozen || !saveSession.createdActivity || !saveSession.activityId || saveSession.stages.READBACK !== 'SUCCEEDED'} onClick={requestProgram}>{programFrozen ? '核对 V2 回读' : '保存话题 V2 配置'}</button>
      <button type="button" className={buttonClass} disabled={saveBusy || publishLocked || !programConfirmed || !saveSession.activityId} onClick={requestLottery}>{lotteryFrozen ? '核对抽奖回读' : draft.lottery.enabled ? '保存抽奖配置' : '跳过抽奖配置'}</button>
      <button type="button" className={buttonClass} disabled={saveBusy || published || !canPublish} onClick={requestPublish}>{publishLocked ? '核验发布状态' : '发布话题活动'}</button></div> : null}
    {published ? <div className="border border-green-500 p-3 text-sm"><p>活动已发布，状态已回读确认。</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={openingEditor} onClick={() => void openEditor()}>{openingEditor ? '正在进入简易编辑…' : '进入简易编辑'}</button><button type="button" className={buttonClass} onClick={onClose}>返回活动管理</button></div></div> : null}
    {isEdit && editBaseline ? <section aria-label="编辑保存状态" className="space-y-2 border border-[var(--border)] p-3 text-sm"><p>本次修改：{editSavedStages.length ? editSavedStages.map((stage) => ({ ACTIVITY: '活动信息', PROGRAM: '参与规则与测试题', LOTTERY: '抽奖配置' } as Record<string, string>)[stage] || stage).join('、') + '已保存并回读' : '尚未保存'}</p>
      {editPending ? <p role="status">上次写入结果待核验。本次操作只读取，不会重复提交。</p> : null}
      {editBaseline.lotteryMeta.configLocked ? <p>抽奖配置已被参与或开奖记录锁定，服务端将拒绝修改。</p> : null}
      {editBaseline.testParticipants > 0 ? <p>已有测试答题记录；修改同一测试题时需递增测试版本或改用新测试 ID，历史答题会保留。</p> : null}
      {editLoadError ? <button type="button" className={buttonClass} onClick={reloadEdit}>重新读取</button> : null}</section> : null}
    {!isEdit ? <section aria-label="活动保存会话" className="space-y-2 border border-[var(--border)] p-3 text-sm"><p>活动草稿：{saveSession.activityId ? '已创建并回读确认' : '尚未创建'} · 请求状态：{saveBusy ? '处理中' : '可操作'}</p>
      <ol className="grid gap-2 sm:grid-cols-3">{wizardSaveStages.map((stage) => <li key={stage}>{saveStageLabels[stage]}：{saveStatusLabels[saveSession.stages[stage]]}</li>)}</ol>
      {saveSession.error ? <p role="alert">{saveStageLabels[saveSession.error.stage]}：{saveSession.error.message}</p> : null}
      <p>V2 回读：{saveStatusLabels[saveSession.programSave.readback]}</p>
      {saveSession.programSave.error ? <p role="alert">V2 {({ PREFLIGHT: '保存前核验', SAVE: '保存', READBACK: '回读' })[saveSession.programSave.error.stage]}：{saveSession.programSave.error.message}</p> : null}
      <p>抽奖回读：{saveStatusLabels[saveSession.lotterySave.readback]}</p>
      {saveSession.lotterySave.error ? <p role="alert">抽奖 {({ PREFLIGHT: '保存前核验', SAVE: '保存', READBACK: '回读' })[saveSession.lotterySave.error.stage]}：{saveSession.lotterySave.error.message}</p> : null}
      <p>发布回读：{saveStatusLabels[saveSession.publishSave.readback]}</p>
      {saveSession.publishSave.error ? <p role="alert">发布 {({ PREFLIGHT: '发布前核验', SAVE: '发布请求', READBACK: '回读' })[saveSession.publishSave.error.stage]}：{saveSession.publishSave.error.message}</p> : null}
    </section> : null}
    {mediaStatus ? <p role="status" className="border border-[var(--border)] p-3 text-sm">{mediaStatus}</p> : null}
    {errors.length ? <div role="alert" className="border border-red-400 p-3 text-sm text-[var(--danger)]"><p className="font-bold">请检查以下配置：</p><ul className="list-inside list-disc">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
    {message ? <p role="status" className="border border-[var(--border)] p-3 text-sm">{message}</p> : null}
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
      <button type="button" className={buttonClass} disabled={saveBusy || step === 0} onClick={() => { setStep((current) => Math.max(0, current - 1)); setErrors([]); setMessage('') }}>上一步</button>
      <span className="text-sm text-[var(--foreground-muted)]">第 {step + 1} / 5 步</span>
      {step < 4 ? <button type="button" className={buttonClass} disabled={saveBusy} onClick={next}>下一步</button> : <span className="text-xs">{isEdit ? '确认修改后保存' : '保存草稿或发布活动'}</span>}
    </footer>
  </section>
}
