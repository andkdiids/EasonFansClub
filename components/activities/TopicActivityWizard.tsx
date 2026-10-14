'use client'

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TopicActivityWizardSummary } from './TopicActivityWizardSummary'
import { changeTopicWizardEnd, createTopicWizardDraft, toggleTopicWizardPlatform, topicWizardErrors, topicWizardPlatforms, type TopicActivityWizardDraft } from './TopicActivityWizardState'
import { createWizardId } from './TopicActivityWizardIds'
import { createWizardMedia, selectWizardImage, type WizardMedia } from './TopicActivityWizardMedia'
import { createWizardSnapshot, restoreWizardSnapshot, WizardSaveSessionController, wizardSaveStages, type WizardSaveSession, type WizardSnapshot } from './TopicActivityWizardSession'
import { prepareWizardActivityPayload, prepareWizardProgramPayload, prepareWizardLotteryPayload } from './TopicActivityWizardPayload'
import { saveWizardActivityDraft } from './TopicActivityWizardActivitySave'
import { saveWizardProgram } from './TopicActivityWizardProgramSave'
import { saveWizardLottery } from './TopicActivityWizardLotterySave'
import { prepareWizardPublishGate, publishWizardActivity } from './TopicActivityWizardPublish'

const steps = ['活动信息', '参与规则', '奖励与抽奖', '检查发布']
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

// Object URLs stay on the device and are revoked on replacement/unmount.
function LocalImage({ label, file, onChange, clearLabel }: { label: string; file?: File; onChange: (file?: File) => void; clearLabel?: string }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!file) return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return <div className="space-y-2">
    <Field label={label}><input ref={input} className={inputClass} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const selected = event.target.files?.[0]
      if (!selected) return
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size < 1 || selected.size > 5 * 1024 * 1024) {
        setError('请选择非空且不超过 5MB 的 PNG、JPEG 或 WebP 图片'); event.target.value = ''; return
      }
      setError(''); onChange(selected)
    }} /></Field>
    {file && url ? <img src={url} alt={`${label}本地预览`} className="h-28 max-w-full rounded-sm object-contain" /> : null}
    {file ? <div className="flex items-center gap-2 text-xs"><span className="min-w-0 break-all">{file.name}</span><button type="button" className={buttonClass} onClick={() => { onChange(); setError(''); if (input.current) input.current.value = '' }}>{clearLabel ?? `移除${label}`}</button></div> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    <p className="text-xs text-[var(--foreground-muted)]">仅本地预览，不上传图片。</p>
  </div>
}

export function TopicActivityWizard({ open, onClose, badgeOptions = [], onOpenEditor }: {
  open: boolean; onClose: () => void; badgeOptions?: readonly TopicWizardBadgeOption[]; onOpenEditor?: (activityId: string) => Promise<void> | void
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
  const [dirty, setDirty] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(true)
  const saveBusy = saveSession.requestLock !== null
  const submitted = saveSession.activityId !== null || saveSession.stages.ACTIVITY === 'UNKNOWN'
  const programFrozen = saveSession.programSave.writeAttempted || ['SUCCEEDED', 'UNKNOWN'].includes(saveSession.stages.PROGRAM)
  const lotteryFrozen = saveSession.lotterySave.writeAttempted || ['SUCCEEDED', 'UNKNOWN'].includes(saveSession.stages.LOTTERY)
  const programConfirmed = saveSession.confirmedProgram !== null && saveSession.stages.PROGRAM === 'SUCCEEDED' && saveSession.programSave.readback === 'SUCCEEDED'
  const published = saveSession.confirmedPublish !== null && saveSession.publishSave.readback === 'SUCCEEDED'
  const publishLocked = saveSession.publishSave.writeAttempted || published
  const canPublish = programConfirmed && Boolean(saveSession.createdActivity && saveSession.activityId)
    && (!draft.lottery.enabled || Boolean(saveSession.confirmedLottery && saveSession.lotterySave.readback === 'SUCCEEDED'))
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
    if (!confirmation || controller.current.getState().requestLock) return
    const snapshot = createWizardSnapshot(draftRef.current, mediaRef.current, step)
    setMessage(''); setErrors([])
    try {
      const result = await saveWizardActivityDraft(controller.current, snapshot, { onChange: (state) => { if (mounted.current) setSaveSession(state) } })
      if (mounted.current) setMessage(result === 'CONFIRMED'
        ? '活动草稿已创建并回读确认。可继续保存话题 V2 配置。活动未发布，抽奖未保存。'
        : result === 'BLOCKED' ? '请求中或创建结果不明，已阻止重复提交。请核对保存会话。' : '保存流程已停止，输入及已有活动 ID 保留。请查看失败阶段。')
    } catch (cause) {
      if (mounted.current) setErrors([cause instanceof Error ? cause.message : '草稿配置无法提交'])
    } finally {
      if (mounted.current) { setSaveSession(controller.current.getState()); setConfirmation(false) }
    }
  }
  async function saveProgram() {
    if (!programConfirmation || controller.current.getState().requestLock) return
    setErrors([]); setMessage('')
    try {
      const result = await saveWizardProgram(controller.current, createWizardSnapshot(draftRef.current, mediaRef.current, step), {
        onChange: (state) => { if (mounted.current) setSaveSession(state) },
      })
      if (mounted.current) setMessage(result === 'CONFIRMED' ? '话题 V2 配置已回读确认，可继续保存抽奖配置。活动仍为草稿；不上传、不发布、不开奖。'
        : result === 'BLOCKED' ? '缺少本向导创建且已核验的活动 ID，或请求正在处理，不能保存 V2。'
          : 'V2 流程已停止，活动 ID 和配置输入保留；请查看失败阶段。')
    } catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : 'V2 配置无法提交']) }
    finally { if (mounted.current) { setSaveSession(controller.current.getState()); setProgramConfirmation(false) } }
  }
  function requestProgram() {
    const state = controller.current.getState()
    if (state.requestLock || !state.activityId || state.stages.ACTIVITY !== 'SUCCEEDED' || state.stages.READBACK !== 'SUCCEEDED') return
    try {
      prepareWizardProgramPayload(programFrozen ? state.programSave.snapshot! : createWizardSnapshot(draftRef.current, mediaRef.current, step))
      setErrors([]); setProgramConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查 V2 配置']) }
  }
  async function saveLottery() {
    if (!lotteryConfirmation || controller.current.getState().requestLock) return
    setErrors([]); setMessage('')
    try {
      const result = await saveWizardLottery(controller.current, createWizardSnapshot(draftRef.current, mediaRef.current, step), {
        onChange: (state) => { if (mounted.current) setSaveSession(state) },
      })
      if (mounted.current) setMessage(result === 'CONFIRMED' ? '抽奖配置已保存并回读确认。活动仍为草稿；未发布、未开奖，未发放奖励。'
        : result === 'SKIPPED' ? '抽奖开关关闭，已跳过配置保存；未请求抽奖接口，不会关闭已有配置。'
          : result === 'BLOCKED' ? '缺少本向导活动或 V2 成功回执，或请求正在处理，不能保存抽奖。'
            : '抽奖配置流程已停止。输入、活动 ID 和阶段状态保留；已发送请求后仅允许回读核对。')
    } catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : '抽奖配置无法提交']) }
    finally { if (mounted.current) { setSaveSession(controller.current.getState()); setLotteryConfirmation(false) } }
  }
  function requestLottery() {
    const state = controller.current.getState()
    if (state.requestLock || !programConfirmed || !state.activityId) return
    try {
      prepareWizardLotteryPayload(lotteryFrozen ? state.lotterySave.snapshot! : createWizardSnapshot(draftRef.current, mediaRef.current, step))
      setErrors([]); setLotteryConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查抽奖配置']) }
  }
  async function publish() {
    if (!publishConfirmation || controller.current.getState().requestLock) return
    setErrors([]); setMessage('')
    try {
      const result = await publishWizardActivity(controller.current, createWizardSnapshot(draftRef.current, mediaRef.current, step), {
        onChange: (state) => { if (mounted.current) setSaveSession(state) },
      })
      if (mounted.current) setMessage(result === 'CONFIRMED' ? '活动已发布，GET 回读确认 PUBLISHED。向导保存已锁定，请进入现有编辑页继续管理。'
        : result === 'BLOCKED' ? '缺少本向导保存成功回执、请求处理中或已发布，已阻止重复发布。'
          : '发布流程已停止。已有状态和活动 ID 保留；发布请求发出后仅允许 GET 核验，不重复 PATCH。')
    } catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : '发布校验失败']) }
    finally { if (mounted.current) { setSaveSession(controller.current.getState()); setPublishConfirmation(false) } }
  }
  function requestPublish() {
    const state = controller.current.getState()
    if (state.requestLock || state.confirmedPublish || !canPublish) return
    try {
      prepareWizardPublishGate(state.publishSave.writeAttempted ? state.publishSave.snapshot! : createWizardSnapshot(draftRef.current, mediaRef.current, step), state)
      setErrors([]); setPublishConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查发布配置']) }
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
    if (controller.current.getState().requestLock || (saveSession.stages.ACTIVITY === 'UNKNOWN' && !saveSession.activityId)) return
    try {
      prepareWizardActivityPayload(saveSession.activityId ? saveSession.snapshot! : createWizardSnapshot(draftRef.current, mediaRef.current, step))
      setErrors([]); setConfirmation(true)
    } catch (cause) { setErrors([cause instanceof Error ? cause.message : '请检查活动配置']) }
  }
  function next() {
    const problems = topicWizardErrors(draft, step)
    setErrors(problems)
    if (!problems.length) setStep((current) => Math.min(3, current + 1))
  }
  if (!open) return null
  return <section aria-label="话题活动创建向导" className="min-w-0 space-y-5 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
    <ConfirmDialog open={confirmation} title={saveSession.activityId ? '重新回读活动草稿？' : '创建话题活动草稿？'}
      description="本阶段仅创建 TOPIC_ACTIVITY 草稿并回读；不保存 V2、奖励或抽奖配置，不上传图片，不发布。已取得活动 ID 后只回读，不重复创建。"
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
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 ref={titleRef} tabIndex={-1} className="text-xl font-bold outline-none">创建话题活动 · {steps[step]}</h2>
        <p className="mt-2 text-sm text-[var(--foreground-muted)]">抽奖是话题活动的可选扩展，不是独立活动类型。</p></div>
      <button type="button" className={buttonClass} disabled={saveBusy} onClick={() => dirty ? setCloseConfirm(true) : onClose()}>收起向导</button>
    </header>
    <p role="note" className="border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">Phase 3 · 分步保存后，完整核验并明确确认才发布。不上传、不调用开奖或履约接口。刷新会丢失页面会话，结果不明时先核验，不重复提交。</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={saveBusy || publishLocked} onClick={captureLocalSnapshot}>保留本地快照</button><button type="button" className={buttonClass} disabled={saveBusy || publishLocked || submitted || !localSnapshot} onClick={() => setRestoreConfirm(true)}>恢复本地快照</button></div>
    <fieldset disabled={saveBusy || publishLocked || (programFrozen && step === 1) || (lotteryFrozen && step === 2) || (submitted && step === 0)} className="min-w-0 space-y-5">
    <ol aria-label="配置步骤" className="grid grid-cols-2 gap-2 sm:grid-cols-4">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}
      className={`rounded-sm border p-3 text-sm ${step === index ? 'border-[var(--primary)] font-bold' : 'border-[var(--border)] text-[var(--foreground-muted)]'}`}>{index + 1}. {label}</li>)}</ol>

    {step === 0 ? <div className="space-y-4">
      <Field label="活动名称"><input className={inputClass} autoComplete="off" maxLength={160} value={draft.activity.title} onChange={(event) => activity({ title: event.target.value })} placeholder="例如：天使的礼物" /></Field>
      <LocalImage label="活动封面" clearLabel="取消选择" file={media.cover.file || undefined} onChange={(file) => updateMedia((current) => ({ ...current, cover: selectWizardImage(file) }))} />
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
        <Field label="活动结束（北京时间）"><input className={inputClass} type="datetime-local" value={draft.activity.endsAt || ''} onChange={(event) => update((current) => changeTopicWizardEnd(current, event.target.value))} /></Field>
      </div><p className="text-xs text-[var(--foreground-muted)]">活动时间控制参与周期。平台任务复用此时间；开启抽奖时，资格截止默认同活动结束，不重复填写。</p>
    </div> : null}

    {step === 1 ? <div className="space-y-4">
      <Field label="用户如何参与话题活动"><textarea disabled={submitted} className={inputClass} rows={3} maxLength={2000} value={draft.activity.participationRule || ''} onChange={(event) => activity({ participationRule: event.target.value })} placeholder="例如：发布活动相关内容，在活动主帖提交分享截图，等待管理员审核。" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked disabled />参与评论需要管理员审核（现有规则，不可关闭）</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={submitted} checked={draft.activity.allowImageAttachments} onChange={(event) => activity({ allowImageAttachments: event.target.checked })} />允许图片附件</label>
      <fieldset className="space-y-3 border border-[var(--border)] p-3"><legend className="px-1 font-bold">外部平台任务（可选）</legend>
        <p className="text-xs text-[var(--foreground-muted)]">普通话题可不选平台；开启抽奖必须有有效的平台截图任务。允许多次评论，拒绝后可重新提交。</p>
        <div className="flex flex-wrap gap-4">{topicWizardPlatforms.map((platform) => <label key={platform.key} className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.program.entries.some((entry) => entry.platformKey === platform.key)} onChange={() => update((current) => toggleTopicWizardPlatform(current, platform.key))} />{platform.name}</label>)}</div>
        {draft.program.entries.map((entry) => <div key={entry.id} className="space-y-3 border-t border-[var(--border)] pt-3">
          <Field label={`${entry.platformName}任务标题`}><input className={inputClass} maxLength={512} value={entry.title} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item) } }))} /></Field>
          <Field label={`${entry.platformName}任务要求`}><textarea className={inputClass} rows={2} maxLength={8000} value={entry.instructions} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, instructions: event.target.value } : item) } }))} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">{(['minImages', 'maxImages'] as const).map((key) => <Field key={key} label={`${entry.platformName}${key === 'minImages' ? '最少' : '最多'}截图数`}><input className={inputClass} type="number" min={1} max={20} value={entry[key]} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, [key]: Number(event.target.value) } : item) } }))} /></Field>)}</div>
        </div>)}
      </fieldset>
    </div> : null}

    {step === 2 ? <div className="space-y-5">
      <fieldset disabled={programFrozen} className="space-y-3 border border-[var(--border)] p-3"><legend className="px-1 font-bold">A. 参与奖励</legend>
        <p className="text-xs">平台任务审核通过后按入口独立发放挂号费，现有规则要求每入口至少 1；不会增加抽奖次数。</p>
        {draft.program.entries.map((entry) => <Field key={entry.id} label={`${entry.platformName}挂号费奖励`}><input className={inputClass} type="number" min={1} max={2000000000} value={entry.points} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, entries: current.program.entries.map((item) => item.id === entry.id ? { ...item, points: Number(event.target.value) } : item) } }))} /></Field>)}
        {!draft.program.entries.length ? <p className="text-sm">未选择平台任务，本阶段不配置固定挂号费奖励。</p> : null}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.program.medal.enabled} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, medal: { ...current.program.medal, enabled: event.target.checked, triggers: [current.program.entries.length ? 'PLATFORM' : 'APPROVED_COMMENT'] } } }))} />启用参与勋章</label>
        {draft.program.medal.enabled ? <><Field label="参与奖励勋章"><select className={inputClass} value={draft.program.medal.badgeId || ''} onChange={(event) => update((current) => ({ ...current, program: { ...current.program, medal: { ...current.program.medal, badgeId: event.target.value || null } } }))}>
          <option value="">请选择勋章</option>{badgeOptions.map((badge) => <option key={badge.id} value={badge.id}>{badge.name}</option>)}</select></Field>
          {!badgeOptions.length ? <p className="text-xs">当前没有可用勋章选项。可关闭此项继续本地演示。</p> : null}</> : null}
      </fieldset>
      <fieldset className="space-y-4 border border-[var(--border)] p-3"><legend className="px-1 font-bold">B. 话题活动扩展：抽奖</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.lottery.enabled} onChange={(event) => lottery({ enabled: event.target.checked })} />开启本话题活动抽奖</label>
        {draft.lottery.enabled ? <>
          <p className="text-sm">完成本活动指定平台任务、提交有效截图并审核通过后，获得一次抽奖资格。多个平台不增加次数。</p>
          <p className="text-xs text-[var(--foreground-muted)]">普通讨论评论不是当前资格来源；资格截止复用活动结束时间。</p>
          <fieldset className="space-y-2"><legend className="font-bold">抽奖资格来源</legend>{draft.program.entries.map((entry) => <label key={entry.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.lottery.sourceEntryIds.includes(entry.id)} onChange={(event) => lottery({ sourceEntryIds: event.target.checked ? [...draft.lottery.sourceEntryIds, entry.id] : draft.lottery.sourceEntryIds.filter((id) => id !== entry.id) })} />{entry.platformName}截图任务审核通过</label>)}
          {!draft.program.entries.length ? <p role="note" className="text-sm text-[var(--danger)]">请返回参与规则，配置平台截图任务。</p> : null}</fieldset>
          <div className="space-y-4">{draft.lottery.prizes.map((prize, index) => <section key={prize.id} className="space-y-3 border border-[var(--border)] p-3" aria-label={`奖品 ${index + 1}`}>
            <div className="flex justify-between gap-3"><h4 className="font-bold">奖品 {index + 1}</h4><button type="button" className={buttonClass} onClick={() => { lottery({ prizes: draft.lottery.prizes.filter((item) => item.id !== prize.id) }); updateMedia((current) => { const prizes = { ...current.prizes }; delete prizes[prize.id]; return { ...current, prizes } }) }}>移除奖品 {index + 1}</button></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label={`奖品 ${index + 1}名称`}><input className={inputClass} maxLength={200} value={prize.name} onChange={(event) => lottery({ prizes: draft.lottery.prizes.map((item) => item.id === prize.id ? { ...item, name: event.target.value } : item) })} /></Field>
            <Field label={`奖品 ${index + 1}数量`}><input className={inputClass} type="number" min={1} max={1000} value={prize.quantity} onChange={(event) => lottery({ prizes: draft.lottery.prizes.map((item) => item.id === prize.id ? { ...item, quantity: Number(event.target.value) } : item) })} /></Field></div>
            <LocalImage label={`奖品 ${index + 1}图片`} file={media.prizes[prize.id]?.file || undefined} onChange={(file) => updateMedia((current) => ({ ...current, prizes: { ...current.prizes, [prize.id]: selectWizardImage(file) } }))} />
            {media.prizes[prize.id]?.status === 'NEEDS_RESELECT' ? <p className="text-sm">奖品图片文件未保存在快照中，请重新选择。</p> : null}
          </section>)}</div>
          <button type="button" className={buttonClass} onClick={() => lottery({ prizes: [...draft.lottery.prizes, { id: createWizardId('prize'), name: '', description: '', imageUrl: null, quantity: 1, sortOrder: draft.lottery.prizes.length }] })}>添加奖品</button>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="开奖时间（北京时间）"><input className={inputClass} type="datetime-local" value={draft.lottery.drawAt || ''} onChange={(event) => lottery({ drawAt: event.target.value || null })} /></Field>
          <Field label="开奖方式"><select className={inputClass} value={draft.lottery.mode} onChange={(event) => lottery({ mode: event.target.value as 'AUTO' | 'MANUAL' })}><option value="MANUAL">管理员确认开奖</option><option value="AUTO">到时自动开奖</option></select></Field>
          <Field label="收件截止（北京时间）"><input className={inputClass} type="datetime-local" value={draft.lottery.addressDeadline || ''} onChange={(event) => lottery({ addressDeadline: event.target.value || null })} /></Field></div>
          <p className="text-xs text-[var(--foreground-muted)]">启用配置仍须通过现有服务端加密与规则门禁。本阶段只保存配置，不处理收件、发货或开奖。</p>
        </> : null}
      </fieldset>
      <p className="text-xs text-[var(--foreground-muted)]">本阶段不配置测试、结果海报及表单高级字段。已有活动的完整编辑入口保持不变。</p>
    </div> : null}

    {step === 3 ? <><TopicActivityWizardSummary draft={draft} coverName={media.cover.fileInfo?.name} badgeName={badgeOptions.find((badge) => badge.id === draft.program.medal.badgeId)?.name} />
      <p className="text-sm">先保存活动与 V2；开启抽奖时须保存抽奖配置，最后完整核验并确认发布。发布不等于立即开奖。</p></> : null}
    </fieldset>
    {step === 3 ? <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={saveBusy || publishLocked || saveSession.programSave.writeAttempted || (!saveSession.activityId && saveSession.stages.ACTIVITY === 'UNKNOWN')} onClick={requestDraft}>{saveSession.activityId ? '重新回读草稿' : '创建话题活动草稿'}</button>
      <button type="button" className={buttonClass} disabled={saveBusy || publishLocked || lotteryFrozen || !saveSession.createdActivity || !saveSession.activityId || saveSession.stages.READBACK !== 'SUCCEEDED'} onClick={requestProgram}>{programFrozen ? '核对 V2 回读' : '保存话题 V2 配置'}</button>
      <button type="button" className={buttonClass} disabled={saveBusy || publishLocked || !programConfirmed || !saveSession.activityId} onClick={requestLottery}>{lotteryFrozen ? '核对抽奖回读' : draft.lottery.enabled ? '保存抽奖配置' : '跳过抽奖配置'}</button>
      <button type="button" className={buttonClass} disabled={saveBusy || published || !canPublish} onClick={requestPublish}>{publishLocked ? '核验发布状态' : '发布话题活动'}</button></div> : null}
    {published ? <div className="border border-green-500 p-3 text-sm"><p>已发布，向导保存已锁定。</p>{onOpenEditor ? <button type="button" className={buttonClass} disabled={openingEditor} onClick={() => void openEditor()}>{openingEditor ? '正在进入编辑页…' : '进入活动编辑页'}</button> : <a className="underline" href="/admin/activities">进入活动中心管理，按活动 ID 编辑</a>}</div> : null}
    <section aria-label="活动保存会话" className="space-y-2 border border-[var(--border)] p-3 text-sm"><p>服务器活动：{saveSession.activityId || '未取得创建回执'} · 请求锁：{saveBusy ? '已锁定' : '空闲'}</p>
      <ol className="grid gap-2 sm:grid-cols-3">{wizardSaveStages.map((stage) => <li key={stage}>{saveStageLabels[stage]}：{saveStatusLabels[saveSession.stages[stage]]}</li>)}</ol>
      {saveSession.error ? <p role="alert">{saveStageLabels[saveSession.error.stage]}：{saveSession.error.message}</p> : null}
      <p>V2 回读：{saveStatusLabels[saveSession.programSave.readback]}</p>
      {saveSession.programSave.error ? <p role="alert">V2 {({ PREFLIGHT: '保存前核验', SAVE: '保存', READBACK: '回读' })[saveSession.programSave.error.stage]}：{saveSession.programSave.error.message}</p> : null}
      <p>抽奖回读：{saveStatusLabels[saveSession.lotterySave.readback]}</p>
      {saveSession.lotterySave.error ? <p role="alert">抽奖 {({ PREFLIGHT: '保存前核验', SAVE: '保存', READBACK: '回读' })[saveSession.lotterySave.error.stage]}：{saveSession.lotterySave.error.message}</p> : null}
      <p>发布回读：{saveStatusLabels[saveSession.publishSave.readback]}</p>
      {saveSession.publishSave.error ? <p role="alert">发布 {({ PREFLIGHT: '发布前核验', SAVE: '发布请求', READBACK: '回读' })[saveSession.publishSave.error.stage]}：{saveSession.publishSave.error.message}</p> : null}
    </section>
    {errors.length ? <div role="alert" className="border border-red-400 p-3 text-sm text-[var(--danger)]"><p className="font-bold">请检查以下配置：</p><ul className="list-inside list-disc">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
    {message ? <p role="status" className="border border-[var(--border)] p-3 text-sm">{message}</p> : null}
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
      <button type="button" className={buttonClass} disabled={saveBusy || step === 0} onClick={() => { setStep((current) => Math.max(0, current - 1)); setErrors([]); setMessage('') }}>上一步</button>
      <span className="text-sm text-[var(--foreground-muted)]">第 {step + 1} / 4 步</span>
      {step < 3 ? <button type="button" className={buttonClass} disabled={saveBusy} onClick={next}>下一步</button> : <span className="text-xs">发布须完整核验与明确确认</span>}
    </footer>
  </section>
}
