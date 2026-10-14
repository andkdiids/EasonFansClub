import { defaultTopicLotteryConfig, normalizeTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { prepareWizardActivityPayload, prepareWizardLotteryPayload, prepareWizardProgramPayload } from './TopicActivityWizardPayload'
import { activityFrom, requestWizardResource, verifyWizardActivityReadback, type WizardTransport } from './TopicActivityWizardActivitySave'
import { canonicalWizardValue, wizardProgramsMatch } from './TopicActivityWizardProgramSave'
import { WizardSaveSessionController, type WizardSaveSession, type WizardSnapshot } from './TopicActivityWizardSession'

type Options = { transport?: WizardTransport; timeoutMs?: number; onChange?: (state: WizardSaveSession) => void }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function wizardLotteriesMatch(value: unknown, expected: unknown): boolean {
  if (!value || !expected) return false
  try { return canonicalWizardValue(normalizeTopicLotteryConfig(value)) === canonicalWizardValue(normalizeTopicLotteryConfig(expected)) }
  catch { return false }
}
function safeDraftView(body: unknown) {
  const view = record(body)
  return view.configLocked === false && view.draw === null && Array.isArray(view.winners) && view.winners.length === 0
    && view.candidateCount === 0 && view.pendingSubmissionCount === 0
}
class RejectedSave extends Error {}

/** Configuration only, one possible PATCH per session; all subsequent attempts are read-only. */
export async function saveWizardLottery(controller: WizardSaveSessionController, snapshot: WizardSnapshot, options: Options = {}) {
  const operation = controller.beginLotterySave(snapshot)
  if (!operation) return 'BLOCKED' as const
  const { token, readOnly } = operation, changed = () => options.onChange?.(controller.getState())
  const transport = options.transport ?? fetch, timeout = options.timeoutMs ?? 30_000
  let stage: 'PREFLIGHT' | 'SAVE' | 'READBACK' = readOnly ? 'READBACK' : 'PREFLIGHT'
  changed()
  try {
    const state = controller.getState(), id = state.activityId!
    const payload = prepareWizardLotteryPayload(state.lotterySave.snapshot!)
    if (!payload) return controller.skipLotterySave(token) ? 'SKIPPED' as const : 'BLOCKED' as const
    const base = `/api/admin/activities/${encodeURIComponent(id)}`, endpoint = base + '/v2/lottery'
    const activity = await requestWizardResource(transport, base, { method: 'GET' }, timeout)
    if (!activity.response.ok) throw new Error('活动草稿身份核验失败')
    verifyWizardActivityReadback(activityFrom(activity.body), id, prepareWizardActivityPayload(state.snapshot!))
    const program = await requestWizardResource(transport, base + '/v2', { method: 'GET' }, timeout)
    const programBody = record(program.body), activityView = record(programBody.activity)
    if (!program.response.ok || activityView.id !== id || activityView.status !== 'DRAFT' || programBody.canReview !== true
      || !wizardProgramsMatch(programBody.program, prepareWizardProgramPayload(state.programSave.snapshot!).program)) throw new Error('服务器 V2 配置与成功回执不一致，禁止保存抽奖')
    const current = await requestWizardResource(transport, endpoint, { method: 'GET' }, timeout)
    if (!current.response.ok || !safeDraftView(current.body)) throw new Error('抽奖配置已锁定、有参与记录或响应不完整；停止配置保存')
    if (wizardLotteriesMatch(record(current.body).config, payload.config)) return controller.confirmLotteryReadback(token) ? 'CONFIRMED' as const : 'BLOCKED' as const
    if (readOnly) throw new Error('抽奖回读与原提交快照不一致，仅允许核对，不重发 PATCH')
    if (record(current.body).state !== 'DISABLED' || !wizardLotteriesMatch(record(current.body).config, defaultTopicLotteryConfig())) throw new Error('活动已有其他抽奖配置，禁止覆盖')
    if (record(current.body).addressEncryptionReady !== true) throw new Error('现有收件资料加密配置未就绪；禁止启用实物抽奖')
    if (!controller.markLotteryWriteStarted(token)) return 'BLOCKED' as const
    stage = 'SAVE'; changed()
    const saved = await requestWizardResource(transport, endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, timeout)
    if ([400, 401, 403, 409, 429].includes(saved.response.status)) throw new RejectedSave(`抽奖配置保存被拒绝（${saved.response.status}）；仅允许回读核对`)
    if (!saved.response.ok || !wizardLotteriesMatch(record(saved.body).config, payload.config)) throw new Error('抽奖配置保存响应无法确认')
    if (!controller.acknowledgeLotteryWrite(token)) return 'BLOCKED' as const
    stage = 'READBACK'; changed()
    const confirmed = await requestWizardResource(transport, endpoint, { method: 'GET' }, timeout)
    if (!confirmed.response.ok || !safeDraftView(confirmed.body) || !wizardLotteriesMatch(record(confirmed.body).config, payload.config)) throw new Error('抽奖配置保存后回读不一致；保留活动 ID 与快照，仅允许回读')
    return controller.confirmLotteryReadback(token) ? 'CONFIRMED' as const : 'BLOCKED' as const
  } catch (cause) {
    const unknown = stage === 'SAVE' && !(cause instanceof RejectedSave)
    controller.failLotterySave(token, stage, unknown ? '抽奖配置结果不明，可能已写入；仅可回读，不得重复 PATCH。'
      : cause instanceof Error ? cause.message : '抽奖配置核验失败', unknown)
    return unknown ? 'UNKNOWN' as const : 'FAILED' as const
  } finally { controller.finish(token); changed() }
}
