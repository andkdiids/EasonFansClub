import { defaultTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { prepareWizardActivityPayload, prepareWizardLotteryPayload, prepareWizardProgramPayload } from './TopicActivityWizardPayload'
import { activityFrom, requestWizardResource, verifyWizardActivityReadback, type WizardTransport } from './TopicActivityWizardActivitySave'
import { wizardProgramsMatch } from './TopicActivityWizardProgramSave'
import { wizardLotteriesMatch } from './TopicActivityWizardLotterySave'
import { WizardSaveSessionController, type WizardSaveSession, type WizardSnapshot } from './TopicActivityWizardSession'

type Options = { transport?: WizardTransport; timeoutMs?: number; onChange?: (state: WizardSaveSession) => void; now?: Date }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function prepareWizardPublishGate(snapshot: WizardSnapshot, state: WizardSaveSession) {
  const activity = prepareWizardActivityPayload(snapshot), program = prepareWizardProgramPayload(snapshot), lottery = prepareWizardLotteryPayload(snapshot)
  if (!program.program.enabled) throw new Error('发布前须启用已保存的话题 V2 模块')
  if (!state.programSave.snapshot || !wizardProgramsMatch(program.program, prepareWizardProgramPayload(state.programSave.snapshot).program)) throw new Error('V2 配置与保存快照不一致')
  if (lottery && (!state.lotterySave.snapshot || !wizardLotteriesMatch(lottery.config, prepareWizardLotteryPayload(state.lotterySave.snapshot)?.config))) throw new Error('抽奖配置与保存快照不一致')
  return { activity, program, lottery, publish: { status: 'PUBLISHED' as const } }
}
class RejectedPublish extends Error {}

/** Only a status patch. Never saves configuration, retries a write or invokes a draw. */
export async function publishWizardActivity(controller: WizardSaveSessionController, snapshot: WizardSnapshot, options: Options = {}) {
  const operation = controller.beginPublish(snapshot)
  if (!operation) return 'BLOCKED' as const
  const { token, readOnly } = operation, changed = () => options.onChange?.(controller.getState())
  const transport = options.transport ?? fetch, timeout = options.timeoutMs ?? 30_000
  let stage: 'PREFLIGHT' | 'SAVE' | 'READBACK' = readOnly ? 'READBACK' : 'PREFLIGHT'
  changed()
  try {
    const state = controller.getState(), id = state.activityId!, gate = prepareWizardPublishGate(state.publishSave.snapshot!, state)
    const base = `/api/admin/activities/${encodeURIComponent(id)}`
    const initial = await requestWizardResource(transport, base, { method: 'GET' }, timeout)
    const activity = activityFrom(initial.body)
    if (!initial.response.ok || !activity || !['DRAFT', 'PUBLISHED'].includes(String(activity.status))) throw new Error('活动状态或身份不可发布')
    const currentStatus = activity.status as 'DRAFT' | 'PUBLISHED'
    verifyWizardActivityReadback(activity, id, gate.activity, currentStatus)
    const program = await requestWizardResource(transport, base + '/v2', { method: 'GET' }, timeout)
    const programBody = record(program.body), programActivity = record(programBody.activity)
    if (!program.response.ok || programActivity.id !== id || programActivity.status !== currentStatus || programBody.canReview !== true
      || !wizardProgramsMatch(programBody.program, gate.program.program)) throw new Error('服务器 V2 与保存回执不一致')
    // Even when UI is off, check that server lottery is off: skipping configuration does not disable it.
    const lottery = await requestWizardResource(transport, base + '/v2/lottery', { method: 'GET' }, timeout)
    const lotteryBody = record(lottery.body)
    if (!lottery.response.ok || !Object.hasOwn(lotteryBody, 'config')) throw new Error('抽奖配置核验失败')
    if (gate.lottery) {
      if (!wizardLotteriesMatch(lotteryBody.config, gate.lottery.config) || lotteryBody.addressEncryptionReady !== true) throw new Error('抽奖配置或实物收件加密未就绪')
      if (currentStatus === 'DRAFT' && (lotteryBody.configLocked !== false || lotteryBody.draw !== null || !Array.isArray(lotteryBody.winners) || lotteryBody.winners.length !== 0
        || lotteryBody.candidateCount !== 0 || lotteryBody.pendingSubmissionCount !== 0)) throw new Error('抽奖存在参与、冻结或开奖记录，禁止向导发布')
    } else if (!wizardLotteriesMatch(lotteryBody.config, defaultTopicLotteryConfig())) throw new Error('服务器存在未核验的抽奖配置，不能按关闭状态发布')
    if (currentStatus === 'PUBLISHED') return controller.confirmPublishReadback(token) ? 'CONFIRMED' as const : 'BLOCKED' as const
    if (readOnly) throw new Error('活动尚未发布。原请求已发送，仅允许核验，不会重复 PATCH')
    const now = options.now ?? new Date()
    if (!gate.activity.endsAt || new Date(gate.activity.endsAt) <= now) throw new Error('活动参与时间已结束，禁止发布')
    if (gate.lottery && (new Date(gate.lottery.config.eligibilityDeadline!) <= now || new Date(gate.lottery.config.drawAt!) <= now)) throw new Error('资格截止或开奖时间已过，禁止首次发布')
    if (!controller.markPublishWriteStarted(token)) return 'BLOCKED' as const
    stage = 'SAVE'; changed()
    const saved = await requestWizardResource(transport, base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gate.publish) }, timeout)
    if ([400, 401, 403, 404, 409, 429].includes(saved.response.status)) throw new RejectedPublish(`发布被拒绝（${saved.response.status}），状态保留；仅可 GET 核验`)
    if (!saved.response.ok) throw new Error('发布响应无法确认')
    verifyWizardActivityReadback(activityFrom(saved.body), id, gate.activity, 'PUBLISHED')
    if (!controller.acknowledgePublish(token)) return 'BLOCKED' as const
    stage = 'READBACK'; changed()
    const confirmed = await requestWizardResource(transport, base, { method: 'GET' }, timeout)
    if (!confirmed.response.ok) throw new Error('发布后回读失败；不重复发送发布请求')
    verifyWizardActivityReadback(activityFrom(confirmed.body), id, gate.activity, 'PUBLISHED')
    return controller.confirmPublishReadback(token) ? 'CONFIRMED' as const : 'BLOCKED' as const
  } catch (cause) {
    const unknown = stage === 'SAVE' && !(cause instanceof RejectedPublish)
    controller.failPublish(token, stage, unknown ? '发布结果不明，可能已生效；仅允许 GET 核验，不重复 PATCH。'
      : cause instanceof Error ? cause.message : '发布校验失败', unknown)
    return unknown ? 'UNKNOWN' as const : 'FAILED' as const
  } finally { controller.finish(token); changed() }
}
