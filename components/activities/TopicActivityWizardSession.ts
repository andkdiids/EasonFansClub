import type { TopicActivityWizardDraft } from './TopicActivityWizardState'
import { restoreWizardMedia, snapshotWizardMedia, type WizardMedia, type WizardMediaSnapshot } from './TopicActivityWizardMedia'
import { createWizardId } from './TopicActivityWizardIds'

export type WizardSnapshot = {
  version: 1; id: string; draftId: string; draft: TopicActivityWizardDraft; media: WizardMediaSnapshot; step: number
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
export function createWizardSnapshot(draft: TopicActivityWizardDraft, media: WizardMedia, step: number): WizardSnapshot {
  return freeze({ version: 1, id: createWizardId('snapshot'), draftId: draft.identity.draftId,
    draft: structuredClone(draft), media: snapshotWizardMedia(media), step })
}
export function restoreWizardSnapshot(snapshot: WizardSnapshot) {
  if (snapshot.version !== 1 || snapshot.draftId !== snapshot.draft.identity.draftId || !Number.isInteger(snapshot.step) || snapshot.step < 0 || snapshot.step > 4) throw new Error('快照不属于有效的向导草稿')
  return { draft: structuredClone(snapshot.draft), media: restoreWizardMedia(snapshot.media), step: snapshot.step }
}

export const wizardSaveStages = ['UPLOAD', 'ACTIVITY', 'PROGRAM', 'LOTTERY', 'READBACK', 'PUBLISH'] as const
export type WizardSaveStage = typeof wizardSaveStages[number]
export type WizardStageStatus = 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'SKIPPED' | 'SIMULATED'
export type WizardSaveIntent = 'DRAFT' | 'PUBLISHED'
export type WizardRequestToken = { id: string; sessionId: string; snapshotId: string }
export type WizardSaveSession = {
  version: 1; id: string; draftId: string; mode: 'SIMULATION' | 'API'; activityId: string | null
  stages: Record<WizardSaveStage, WizardStageStatus>; requestLock: WizardRequestToken | null
  error: { stage: WizardSaveStage; message: string } | null
  snapshot: WizardSnapshot | null; intent: WizardSaveIntent | null; needsReadback: boolean
  createdActivity: { activityId: string; draftId: string; snapshotId: string } | null
  confirmedProgram: { activityId: string; draftId: string; snapshotId: string } | null
  confirmedLottery: { activityId: string; draftId: string; snapshotId: string } | null
  confirmedPublish: { activityId: string; draftId: string; snapshotId: string } | null
  programSave: { snapshot: WizardSnapshot | null; writeAttempted: boolean; readback: WizardStageStatus;
    error: { stage: 'PREFLIGHT' | 'SAVE' | 'READBACK'; message: string } | null }
  lotterySave: { snapshot: WizardSnapshot | null; writeAttempted: boolean; readback: WizardStageStatus;
    error: { stage: 'PREFLIGHT' | 'SAVE' | 'READBACK'; message: string } | null }
  publishSave: { snapshot: WizardSnapshot | null; writeAttempted: boolean; readback: WizardStageStatus;
    error: { stage: 'PREFLIGHT' | 'SAVE' | 'READBACK'; message: string } | null }
}
const initialStages = () => Object.fromEntries(wizardSaveStages.map((stage) => [stage, 'IDLE'])) as WizardSaveSession['stages']

/** Local controller only. No transport, credentials, or browser persistence. */
export class WizardSaveSessionController {
  private state: WizardSaveSession
  constructor(draftId: string, mode: WizardSaveSession['mode'] = 'SIMULATION') {
    this.state = { version: 1, id: createWizardId('session'), draftId, mode, activityId: null,
      stages: initialStages(), requestLock: null, error: null, snapshot: null, intent: null, needsReadback: false,
      createdActivity: null, confirmedProgram: null, confirmedLottery: null, confirmedPublish: null,
      programSave: { snapshot: null, writeAttempted: false, readback: 'IDLE', error: null },
      lotterySave: { snapshot: null, writeAttempted: false, readback: 'IDLE', error: null },
      publishSave: { snapshot: null, writeAttempted: false, readback: 'IDLE', error: null } }
  }
  getState(): WizardSaveSession { return structuredClone(this.state) }
  getCheckpoint(): WizardSaveSession { return this.getState() }
  static restore(checkpoint: WizardSaveSession): WizardSaveSessionController {
    if (checkpoint.version !== 1 || !['API', 'SIMULATION'].includes(checkpoint.mode)
      || wizardSaveStages.some((stage) => !['IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'SKIPPED', 'SIMULATED'].includes(checkpoint.stages[stage]))) throw new Error('保存会话快照无效')
    if (checkpoint.snapshot) restoreWizardSnapshot(checkpoint.snapshot)
    if (checkpoint.mode === 'SIMULATION' && (checkpoint.activityId || wizardSaveStages.some((stage) => checkpoint.stages[stage] === 'SUCCEEDED'))) throw new Error('模拟会话不能包含服务器保存结果')
    if (checkpoint.snapshot && checkpoint.snapshot.draftId !== checkpoint.draftId) throw new Error('保存会话与提交快照不匹配')
    const controller = new WizardSaveSessionController(checkpoint.draftId, checkpoint.mode)
    controller.state = structuredClone(checkpoint)
    // Older checkpoints have no creation provenance: they cannot authorize V2 writes.
    controller.state.createdActivity ??= null
    controller.state.confirmedProgram ??= null
    controller.state.confirmedLottery ??= null
    controller.state.confirmedPublish ??= null
    controller.state.programSave ??= { snapshot: null, writeAttempted: false, readback: 'IDLE', error: null }
    controller.state.lotterySave ??= { snapshot: null, writeAttempted: false, readback: 'IDLE', error: null }
    controller.state.publishSave ??= { snapshot: null, writeAttempted: false, readback: 'IDLE', error: null }
    controller.state.requestLock = null
    for (const stage of wizardSaveStages) if (controller.state.stages[stage] === 'RUNNING') {
      controller.state.stages[stage] = 'UNKNOWN'
      controller.state.error = { stage, message: '操作中断，结果不明；必须核对后才能继续' }
    }
    if (controller.state.programSave.readback === 'RUNNING') controller.state.programSave.readback = 'UNKNOWN'
    if (controller.state.lotterySave.readback === 'RUNNING') controller.state.lotterySave.readback = 'UNKNOWN'
    if (controller.state.publishSave.readback === 'RUNNING') controller.state.publishSave.readback = 'UNKNOWN'
    controller.state.needsReadback = checkpoint.needsReadback || checkpoint.activityId !== null
      || wizardSaveStages.some((stage) => ['UNKNOWN', 'SUCCEEDED'].includes(controller.state.stages[stage]))
    return controller
  }
  begin(snapshot: WizardSnapshot, intent: WizardSaveIntent): WizardRequestToken | null {
    if (this.savingLocked() || this.state.requestLock || this.state.needsReadback || wizardSaveStages.some((stage) => this.state.stages[stage] === 'UNKNOWN')) return null
    restoreWizardSnapshot(snapshot)
    if (snapshot.draftId !== this.state.draftId) throw new Error('不能将其他活动草稿绑定到当前保存会话')
    const committed = wizardSaveStages.some((stage) => this.state.stages[stage] === 'SUCCEEDED')
    if (committed && (snapshot.id !== this.state.snapshot?.id || intent !== this.state.intent)) throw new Error('存在已保存阶段，请恢复原提交快照；不能静默换用新输入')
    if (!committed) this.state.stages = initialStages()
    else for (const stage of wizardSaveStages) if (this.state.stages[stage] === 'FAILED') this.state.stages[stage] = 'IDLE'
    this.state.snapshot = freeze(structuredClone(snapshot))
    this.state.intent = intent
    this.state.error = null
    const token = { id: createWizardId('request'), sessionId: this.state.id, snapshotId: snapshot.id }
    this.state.requestLock = token
    return { ...token }
  }
  private active(token: WizardRequestToken) {
    return this.state.requestLock?.id === token.id && token.sessionId === this.state.id && token.snapshotId === this.state.snapshot?.id
  }
  private savingLocked() { return this.state.publishSave.writeAttempted || this.state.confirmedPublish !== null }
  /** Explicit read-only recovery: never starts another activity create. */
  beginActivityReadback(): WizardRequestToken | null {
    if (this.savingLocked() || this.state.requestLock || this.state.mode !== 'API' || !this.state.activityId || !this.state.snapshot
      || this.state.stages.ACTIVITY !== 'SUCCEEDED' || this.state.programSave.writeAttempted || this.state.lotterySave.writeAttempted) return null
    this.state.stages.READBACK = 'IDLE'
    this.state.error = null
    this.state.needsReadback = false
    const token = { id: createWizardId('request'), sessionId: this.state.id, snapshotId: this.state.snapshot.id }
    this.state.requestLock = token
    return { ...token }
  }
  beginProgramSave(snapshot: WizardSnapshot): { token: WizardRequestToken; readOnly: boolean } | null {
    const receipt = this.state.createdActivity
    if (this.savingLocked() || this.state.requestLock || this.state.lotterySave.writeAttempted || this.state.mode !== 'API' || !receipt || !this.state.activityId || !this.state.snapshot
      || receipt.activityId !== this.state.activityId || receipt.draftId !== this.state.draftId || receipt.snapshotId !== this.state.snapshot.id
      || this.state.stages.ACTIVITY !== 'SUCCEEDED' || this.state.stages.READBACK !== 'SUCCEEDED') return null
    restoreWizardSnapshot(snapshot)
    if (snapshot.draftId !== receipt.draftId || JSON.stringify(snapshot.draft.activity) !== JSON.stringify(this.state.snapshot.draft.activity)) throw new Error('V2 配置不属于当前向导创建的活动草稿')
    const readOnly = this.state.programSave.writeAttempted || this.state.stages.PROGRAM === 'SUCCEEDED'
    if (this.state.needsReadback && !readOnly) return null
    if (!readOnly) this.state.programSave.snapshot = freeze(structuredClone(snapshot))
    if (!this.state.programSave.snapshot) return null
    this.state.programSave.error = null
    this.state.confirmedProgram = null
    this.state.programSave.readback = 'RUNNING'
    if (!readOnly) this.state.stages.PROGRAM = 'RUNNING'
    const token = { id: createWizardId('request'), sessionId: this.state.id, snapshotId: this.state.snapshot.id }
    this.state.requestLock = token
    return { token: { ...token }, readOnly }
  }
  markProgramWriteStarted(token: WizardRequestToken): boolean {
    if (!this.active(token) || this.state.programSave.writeAttempted) return false
    this.state.programSave.writeAttempted = true
    this.state.stages.PROGRAM = 'RUNNING'
    return true
  }
  acknowledgeProgramWrite(token: WizardRequestToken): boolean {
    if (!this.active(token) || !this.state.programSave.writeAttempted) return false
    this.state.stages.PROGRAM = 'SUCCEEDED'
    return true
  }
  confirmProgramReadback(token: WizardRequestToken): boolean {
    if (!this.active(token)) return false
    this.state.stages.PROGRAM = 'SUCCEEDED'
    this.state.programSave.readback = 'SUCCEEDED'
    this.state.programSave.error = null
    this.state.confirmedProgram = { activityId: this.state.activityId!, draftId: this.state.draftId, snapshotId: this.state.programSave.snapshot!.id }
    this.state.needsReadback = false
    return true
  }
  beginLotterySave(snapshot: WizardSnapshot): { token: WizardRequestToken; readOnly: boolean } | null {
    const receipt = this.state.createdActivity, program = this.state.confirmedProgram
    if (this.savingLocked() || this.state.requestLock || this.state.mode !== 'API' || !receipt || !program || !this.state.activityId || !this.state.snapshot || !this.state.programSave.snapshot
      || receipt.activityId !== this.state.activityId || receipt.draftId !== this.state.draftId || receipt.snapshotId !== this.state.snapshot.id
      || program.activityId !== this.state.activityId || program.draftId !== this.state.draftId || program.snapshotId !== this.state.programSave.snapshot.id
      || this.state.stages.ACTIVITY !== 'SUCCEEDED' || this.state.stages.READBACK !== 'SUCCEEDED' || this.state.stages.PROGRAM !== 'SUCCEEDED'
      || this.state.programSave.readback !== 'SUCCEEDED') return null
    restoreWizardSnapshot(snapshot)
    if (snapshot.draftId !== this.state.draftId || JSON.stringify(snapshot.draft.activity) !== JSON.stringify(this.state.snapshot.draft.activity)
      || JSON.stringify(snapshot.draft.program) !== JSON.stringify(this.state.programSave.snapshot.draft.program)) throw new Error('抽奖配置不属于已核验的活动与 V2 快照')
    const readOnly = this.state.lotterySave.writeAttempted || this.state.stages.LOTTERY === 'SUCCEEDED'
    if (this.state.needsReadback && !readOnly) return null
    if (!readOnly) this.state.lotterySave.snapshot = freeze(structuredClone(snapshot))
    if (!this.state.lotterySave.snapshot) return null
    this.state.lotterySave.error = null
    this.state.confirmedLottery = null
    this.state.lotterySave.readback = 'RUNNING'
    if (!readOnly) this.state.stages.LOTTERY = 'RUNNING'
    const token = { id: createWizardId('request'), sessionId: this.state.id, snapshotId: this.state.snapshot.id }
    this.state.requestLock = token
    return { token: { ...token }, readOnly }
  }
  skipLotterySave(token: WizardRequestToken): boolean {
    if (!this.active(token) || this.state.lotterySave.writeAttempted) return false
    this.state.stages.LOTTERY = 'SKIPPED'; this.state.lotterySave.readback = 'SKIPPED'
    return true
  }
  markLotteryWriteStarted(token: WizardRequestToken): boolean {
    if (!this.active(token) || this.state.lotterySave.writeAttempted) return false
    this.state.lotterySave.writeAttempted = true; this.state.stages.LOTTERY = 'RUNNING'
    return true
  }
  acknowledgeLotteryWrite(token: WizardRequestToken): boolean {
    if (!this.active(token) || !this.state.lotterySave.writeAttempted) return false
    this.state.stages.LOTTERY = 'SUCCEEDED'
    return true
  }
  confirmLotteryReadback(token: WizardRequestToken): boolean {
    if (!this.active(token)) return false
    this.state.stages.LOTTERY = 'SUCCEEDED'; this.state.lotterySave.readback = 'SUCCEEDED'
    this.state.lotterySave.error = null; this.state.needsReadback = false
    this.state.confirmedLottery = { activityId: this.state.activityId!, draftId: this.state.draftId, snapshotId: this.state.lotterySave.snapshot!.id }
    return true
  }
  beginPublish(snapshot: WizardSnapshot): { token: WizardRequestToken; readOnly: boolean } | null {
    const activity = this.state.createdActivity, program = this.state.confirmedProgram
    if (this.state.requestLock || this.state.confirmedPublish || this.state.mode !== 'API' || !activity || !program || !this.state.activityId || !this.state.snapshot || !this.state.programSave.snapshot
      || activity.activityId !== this.state.activityId || activity.draftId !== this.state.draftId || activity.snapshotId !== this.state.snapshot.id
      || program.activityId !== this.state.activityId || program.draftId !== this.state.draftId || program.snapshotId !== this.state.programSave.snapshot.id
      || this.state.stages.ACTIVITY !== 'SUCCEEDED' || this.state.stages.READBACK !== 'SUCCEEDED' || this.state.stages.PROGRAM !== 'SUCCEEDED'
      || this.state.programSave.readback !== 'SUCCEEDED') return null
    restoreWizardSnapshot(snapshot)
    if (snapshot.draftId !== this.state.draftId || JSON.stringify(snapshot.draft.activity) !== JSON.stringify(this.state.snapshot.draft.activity)
      || JSON.stringify(snapshot.draft.program) !== JSON.stringify(this.state.programSave.snapshot.draft.program)) throw new Error('发布快照不属于本向导已保存的活动与 V2')
    const readOnly = this.state.publishSave.writeAttempted
    if (this.state.needsReadback && !readOnly) return null
    if (!readOnly && snapshot.draft.lottery.enabled) {
      const receipt = this.state.confirmedLottery
      if (!receipt || !this.state.lotterySave.snapshot || receipt.activityId !== this.state.activityId || receipt.draftId !== this.state.draftId
        || receipt.snapshotId !== this.state.lotterySave.snapshot.id || this.state.stages.LOTTERY !== 'SUCCEEDED' || this.state.lotterySave.readback !== 'SUCCEEDED') return null
    }
    if (!readOnly && this.state.lotterySave.writeAttempted && !snapshot.draft.lottery.enabled) return null
    if (!readOnly) this.state.publishSave.snapshot = freeze(structuredClone(snapshot))
    if (!this.state.publishSave.snapshot) return null
    this.state.publishSave.error = null; this.state.publishSave.readback = 'RUNNING'
    if (!readOnly) this.state.stages.PUBLISH = 'RUNNING'
    const token = { id: createWizardId('request'), sessionId: this.state.id, snapshotId: this.state.snapshot.id }
    this.state.requestLock = token
    return { token: { ...token }, readOnly }
  }
  markPublishWriteStarted(token: WizardRequestToken): boolean {
    if (!this.active(token) || this.state.publishSave.writeAttempted) return false
    this.state.publishSave.writeAttempted = true; this.state.stages.PUBLISH = 'RUNNING'
    return true
  }
  acknowledgePublish(token: WizardRequestToken): boolean {
    if (!this.active(token) || !this.state.publishSave.writeAttempted) return false
    this.state.stages.PUBLISH = 'SUCCEEDED'
    return true
  }
  confirmPublishReadback(token: WizardRequestToken): boolean {
    if (!this.active(token)) return false
    this.state.stages.PUBLISH = 'SUCCEEDED'; this.state.publishSave.readback = 'SUCCEEDED'
    this.state.publishSave.error = null; this.state.needsReadback = false
    this.state.confirmedPublish = { activityId: this.state.activityId!, draftId: this.state.draftId, snapshotId: this.state.publishSave.snapshot!.id }
    return true
  }
  failPublish(token: WizardRequestToken, stage: 'PREFLIGHT' | 'SAVE' | 'READBACK', message: string, unknown = false): boolean {
    if (!this.active(token)) return false
    this.state.publishSave.error = { stage, message }; this.state.publishSave.readback = 'FAILED'
    if (stage !== 'READBACK') this.state.stages.PUBLISH = unknown ? 'UNKNOWN' : 'FAILED'
    else if (this.state.stages.PUBLISH === 'RUNNING') this.state.stages.PUBLISH = 'UNKNOWN'
    return true
  }
  failLotterySave(token: WizardRequestToken, stage: 'PREFLIGHT' | 'SAVE' | 'READBACK', message: string, unknown = false): boolean {
    if (!this.active(token)) return false
    this.state.lotterySave.error = { stage, message }; this.state.lotterySave.readback = 'FAILED'
    if (stage !== 'READBACK') this.state.stages.LOTTERY = unknown ? 'UNKNOWN' : 'FAILED'
    else if (this.state.stages.LOTTERY === 'RUNNING') this.state.stages.LOTTERY = 'UNKNOWN'
    // Once PATCH was sent, even a definite rejection cannot silently authorize another PATCH.
    return true
  }
  failProgramSave(token: WizardRequestToken, stage: 'PREFLIGHT' | 'SAVE' | 'READBACK', message: string, unknown = false): boolean {
    if (!this.active(token)) return false
    this.state.programSave.error = { stage, message }
    this.state.programSave.readback = 'FAILED'
    if (stage !== 'READBACK') this.state.stages.PROGRAM = unknown ? 'UNKNOWN' : 'FAILED'
    else if (this.state.stages.PROGRAM === 'RUNNING') this.state.stages.PROGRAM = 'UNKNOWN'
    if (stage === 'SAVE' && !unknown) this.state.programSave.writeAttempted = false
    return true
  }
  startStage(token: WizardRequestToken, stage: WizardSaveStage): boolean {
    if (!this.active(token)) return false
    const index = wizardSaveStages.indexOf(stage)
    if (this.state.mode === 'API' && index >= 2 && !this.state.activityId) throw new Error('缺少已保存活动 ID，不能继续后续接口阶段')
    if (this.state.mode === 'API' && stage === 'PUBLISH' && (this.state.intent !== 'PUBLISHED' || this.state.stages.READBACK !== 'SUCCEEDED')) throw new Error('发布前必须完成真实回读核验')
    if (this.state.stages[stage] !== 'IDLE' || wizardSaveStages.slice(0, index).some((prior) => !['SUCCEEDED', 'SKIPPED', 'SIMULATED'].includes(this.state.stages[prior]))) throw new Error('保存阶段顺序不正确，不能跳过失败阶段')
    this.state.stages[stage] = 'RUNNING'
    return true
  }
  completeStage(token: WizardRequestToken, stage: WizardSaveStage, status: 'SIMULATED' | 'SUCCEEDED' | 'SKIPPED', activityId?: string): boolean {
    if (!this.active(token)) return false
    if (this.state.stages[stage] !== 'RUNNING') throw new Error('该阶段尚未开始')
    if (this.state.mode === 'SIMULATION' && (status === 'SUCCEEDED' || activityId)) throw new Error('模拟不能标记服务器保存成功或绑定活动 ID')
    if (this.state.mode === 'API' && status === 'SIMULATED') throw new Error('真实保存会话不能使用模拟结果')
    if (stage === 'ACTIVITY' && status === 'SUCCEEDED') {
      if (!activityId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(activityId)) throw new Error('缺少有效的服务器活动 ID')
      if (this.state.activityId && this.state.activityId !== activityId) throw new Error('不能覆盖已绑定的活动 ID')
      this.state.activityId = activityId
      this.state.createdActivity = { activityId, draftId: this.state.draftId, snapshotId: this.state.snapshot!.id }
    } else if (activityId) throw new Error('只有活动保存阶段可以绑定活动 ID')
    this.state.stages[stage] = status
    return true
  }
  failStage(token: WizardRequestToken, stage: WizardSaveStage, message: string, status: 'FAILED' | 'UNKNOWN' = 'FAILED'): boolean {
    if (!this.active(token)) return false
    if (this.state.stages[stage] !== 'RUNNING') throw new Error('该阶段尚未开始')
    this.state.stages[stage] = status
    this.state.error = { stage, message }
    return true
  }
  finish(token: WizardRequestToken): boolean {
    if (!this.active(token)) return false
    for (const stage of wizardSaveStages) if (this.state.stages[stage] === 'RUNNING') {
      this.state.stages[stage] = 'UNKNOWN'
      this.state.error = { stage, message: '操作未完成，结果不明；不得自动重试' }
    }
    if (this.state.programSave.readback === 'RUNNING') this.state.programSave.readback = 'UNKNOWN'
    if (this.state.lotterySave.readback === 'RUNNING') this.state.lotterySave.readback = 'UNKNOWN'
    if (this.state.publishSave.readback === 'RUNNING') this.state.publishSave.readback = 'UNKNOWN'
    this.state.requestLock = null
    return true
  }
}
